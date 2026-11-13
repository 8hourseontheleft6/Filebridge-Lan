//! Minimal system clipboard bridge for the desktop host.
//!
//! The Hub never reads the system clipboard by itself. The UI invokes these
//! commands only while the user has enabled text sync and the window is active.

#[cfg(windows)]
fn read_windows_clipboard() -> Result<Option<String>, String> {
    use std::ptr;
    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalUnlock};
    use windows_sys::Win32::System::Ole::CF_UNICODETEXT;

    let opened = unsafe { OpenClipboard(ptr::null_mut()) };
    if opened == 0 {
        return Err(format!("无法打开系统剪贴板（{}）", unsafe { GetLastError() }));
    }
    if unsafe { IsClipboardFormatAvailable(CF_UNICODETEXT as u32) } == 0 {
        unsafe { CloseClipboard() };
        return Ok(None);
    }
    let handle = unsafe { GetClipboardData(CF_UNICODETEXT as u32) };
    if handle.is_null() {
        unsafe { CloseClipboard() };
        return Err("剪贴板没有可读取的 Unicode 文本".to_string());
    }
    let pointer = unsafe { GlobalLock(handle) } as *const u16;
    if pointer.is_null() {
        unsafe { CloseClipboard() };
        return Err("无法锁定剪贴板文本".to_string());
    }
    let mut length = 0usize;
    while length < 262_144 {
        if unsafe { *pointer.add(length) } == 0 {
            break;
        }
        length += 1;
    }
    let text = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(pointer, length) });
    unsafe {
        GlobalUnlock(handle);
        CloseClipboard();
    }
    Ok(Some(text))
}

#[cfg(windows)]
fn write_windows_clipboard(text: &str) -> Result<(), String> {
    use std::ptr;
    use windows_sys::Win32::Foundation::{GetLastError, GlobalFree};
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };
    use windows_sys::Win32::System::Ole::CF_UNICODETEXT;

    let utf16: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let bytes = utf16.len() * std::mem::size_of::<u16>();
    let opened = unsafe { OpenClipboard(ptr::null_mut()) };
    if opened == 0 {
        return Err(format!("无法打开系统剪贴板（{}）", unsafe { GetLastError() }));
    }
    let result = (|| {
        if unsafe { EmptyClipboard() } == 0 {
            return Err("无法清空系统剪贴板".to_string());
        }
        let handle = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes) };
        if handle.is_null() {
            return Err("无法分配剪贴板内存".to_string());
        }
        let target = unsafe { GlobalLock(handle) } as *mut u16;
        if target.is_null() {
            unsafe { GlobalFree(handle) };
            return Err("无法写入剪贴板内存".to_string());
        }
        unsafe {
            std::ptr::copy_nonoverlapping(utf16.as_ptr(), target, utf16.len());
            GlobalUnlock(handle);
        }
        if unsafe { SetClipboardData(CF_UNICODETEXT as u32, handle) }.is_null() {
            unsafe { GlobalFree(handle) };
            return Err("系统拒绝了剪贴板文本".to_string());
        }
        Ok(())
    })();
    unsafe { CloseClipboard() };
    result
}

#[cfg(not(windows))]
fn read_windows_clipboard() -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(not(windows))]
fn write_windows_clipboard(_text: &str) -> Result<(), String> {
    Err("当前平台不支持系统剪贴板同步".to_string())
}

#[tauri::command]
pub fn clipboard_read_text() -> Result<Option<String>, String> {
    read_windows_clipboard()
}

#[tauri::command]
pub fn clipboard_write_text(text: String) -> Result<(), String> {
    if text.len() > 256 * 1024 {
        return Err("文本超过 256 KiB 限制".to_string());
    }
    write_windows_clipboard(&text)
}

#[cfg(all(test, windows))]
mod tests {
    use super::{read_windows_clipboard, write_windows_clipboard};

    #[test]
    #[ignore = "uses the real Windows clipboard; run explicitly after saving the original value"]
    fn windows_clipboard_roundtrip() {
        let original = read_windows_clipboard().expect("read original");
        let expected = "Filebridge clipboard roundtrip 1.6.0-preview.1";
        write_windows_clipboard(expected).expect("write test text");
        let actual = read_windows_clipboard().expect("read test text");
        if let Some(value) = original {
            write_windows_clipboard(&value).expect("restore clipboard");
        } else {
            write_windows_clipboard("").expect("restore empty clipboard");
        }
        assert_eq!(actual.as_deref(), Some(expected));
    }
}
