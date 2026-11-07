//! Windows single-instance guard.
//!
//! A named mutex keeps the first process alive. A second launch restores and
//! focuses the existing window and exits before Tauri builds a window or starts
//! the Hub/discovery threads. Dev builds use a separate mutex so `tauri dev`
//! is not blocked by an installed stable/preview instance.

#[cfg(windows)]
pub fn claim() -> bool {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    use windows_sys::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows_sys::Win32::System::Threading::CreateMutexW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FindWindowW, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };

    fn wide(value: &str) -> Vec<u16> {
        OsStr::new(value).encode_wide().chain(std::iter::once(0)).collect()
    }

    let name = if cfg!(debug_assertions) {
        "Local\\Filebridge-Lan-SingleInstance-Dev"
    } else {
        "Local\\Filebridge-Lan-SingleInstance"
    };
    let name = wide(name);
    // The handle intentionally lives for the whole process; Windows releases
    // the mutex when the process exits.
    let handle = unsafe { CreateMutexW(std::ptr::null_mut(), 0, name.as_ptr()) };
    if handle.is_null() {
        // If the mutex itself cannot be created, do not block startup.
        return true;
    }
    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        let title = wide("Filebridge-Lan");
        let window = unsafe { FindWindowW(std::ptr::null(), title.as_ptr()) };
        if !window.is_null() {
            unsafe {
                ShowWindow(window, SW_RESTORE);
                SetForegroundWindow(window);
            }
        }
        return false;
    }
    true
}

#[cfg(not(windows))]
pub fn claim() -> bool {
    true
}
