use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

use crate::hub::Meta;

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct Settings {
    download_dir: Option<String>,
}

pub struct DownloadState {
    hub_data_dir: PathBuf,
    settings_path: PathBuf,
    default_dir: String,
    settings: Mutex<Settings>,
    active: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl DownloadState {
    pub fn new(hub_data_dir: PathBuf, default_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&hub_data_dir);
        let settings_path = hub_data_dir.join("settings.json");
        let settings = std::fs::read(&settings_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Settings>(&bytes).ok())
            .unwrap_or_default();
        Self {
            hub_data_dir,
            settings_path,
            default_dir: default_dir.to_string_lossy().to_string(),
            settings: Mutex::new(settings),
            active: Mutex::new(HashMap::new()),
        }
    }

    fn current_dir(&self) -> String {
        let settings = self.settings.lock().unwrap_or_else(|error| error.into_inner());
        settings
            .download_dir
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| self.default_dir.clone())
    }

    fn register(&self, transfer_id: &str) -> Result<Arc<AtomicBool>, String> {
        let mut active = self.active.lock().unwrap_or_else(|error| error.into_inner());
        if active.contains_key(transfer_id) {
            return Err("下载任务已存在".to_string());
        }
        let flag = Arc::new(AtomicBool::new(false));
        active.insert(transfer_id.to_string(), flag.clone());
        Ok(flag)
    }

    fn unregister(&self, transfer_id: &str) {
        let mut active = self.active.lock().unwrap_or_else(|error| error.into_inner());
        active.remove(transfer_id);
    }
}

fn persist_settings(path: &Path, settings: &Settings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("无法创建设置目录: {error}"))?;
    }
    let bytes = serde_json::to_vec_pretty(settings).map_err(|error| format!("序列化设置失败: {error}"))?;
    std::fs::write(path, bytes).map_err(|error| format!("保存设置失败: {error}"))
}

fn split_name(name: &str) -> (String, Option<String>) {
    match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem.to_string(), Some(extension.to_string())),
        _ => (name.to_string(), None),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedFile {
    pub path: String,
    pub existed: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    transfer_id: String,
    loaded: u64,
    total: u64,
    status: String,
}

fn emit_progress(app: &AppHandle, transfer_id: &str, loaded: u64, total: u64, status: &str) {
    let _ = app.emit(
        "download-progress",
        DownloadProgress {
            transfer_id: transfer_id.to_string(),
            loaded,
            total,
            status: status.to_string(),
        },
    );
}

async fn choose_target(dir: &Path, name: &str, size: u64) -> Result<(PathBuf, bool), String> {
    let target = dir.join(name);
    match tokio::fs::metadata(&target).await {
        Ok(existing) if existing.len() == size => Ok((target, true)),
        Ok(_) => {
            let (stem, extension) = split_name(name);
            for index in 1..1000 {
                let candidate = match &extension {
                    Some(extension) => format!("{stem} ({index}).{extension}"),
                    None => format!("{stem} ({index})"),
                };
                let candidate = dir.join(candidate);
                if tokio::fs::metadata(&candidate).await.is_err() {
                    return Ok((candidate, false));
                }
            }
            Err("下载目录中存在过多同名文件".to_string())
        }
        Err(_) => Ok((target, false)),
    }
}

async fn copy_to_temp(
    source: &Path,
    temp: &Path,
    total: u64,
    cancel: &AtomicBool,
    app: &AppHandle,
    transfer_id: &str,
) -> Result<(), String> {
    let mut source_file = tokio::fs::File::open(source)
        .await
        .map_err(|error| format!("读取源文件失败: {error}"))?;
    let mut target_file = tokio::fs::File::create(temp)
        .await
        .map_err(|error| format!("创建临时文件失败: {error}"))?;

    let mut buffer = vec![0u8; 1024 * 1024];
    let mut loaded = 0u64;
    let mut last_emit = Instant::now() - Duration::from_secs(1);

    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("已取消".to_string());
        }

        let read = source_file
            .read(&mut buffer)
            .await
            .map_err(|error| format!("读取源文件失败: {error}"))?;
        if read == 0 {
            break;
        }

        target_file
            .write_all(&buffer[..read])
            .await
            .map_err(|error| format!("写入下载文件失败: {error}"))?;
        loaded += read as u64;

        if last_emit.elapsed() >= Duration::from_millis(150) || loaded >= total {
            emit_progress(app, transfer_id, loaded, total, "copying");
            last_emit = Instant::now();
        }
    }

    target_file
        .flush()
        .await
        .map_err(|error| format!("刷新下载文件失败: {error}"))?;
    target_file
        .sync_all()
        .await
        .map_err(|error| format!("同步下载文件失败: {error}"))?;
    drop(target_file);

    if total > 0 && loaded != total {
        return Err(format!("文件大小不一致：期望 {total}，实际 {loaded}"));
    }
    if cancel.load(Ordering::Relaxed) {
        return Err("已取消".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn get_download_dir(state: State<'_, DownloadState>) -> String {
    state.current_dir()
}

#[tauri::command]
pub fn default_download_dir(state: State<'_, DownloadState>) -> String {
    state.default_dir.clone()
}

#[tauri::command]
pub fn set_download_dir(state: State<'_, DownloadState>, path: String) -> Result<String, String> {
    let trimmed = path.trim();
    let resolved = if trimmed.is_empty() {
        None
    } else {
        let candidate = PathBuf::from(trimmed);
        let absolute = if candidate.is_absolute() {
            candidate
        } else {
            std::env::current_dir()
                .map_err(|error| format!("无法获取当前目录: {error}"))?
                .join(candidate)
        };
        std::fs::create_dir_all(&absolute)
            .map_err(|error| format!("无法创建下载目录: {error}"))?;
        if !absolute.is_dir() {
            return Err("下载路径不是文件夹".to_string());
        }
        Some(absolute.to_string_lossy().to_string())
    };

    let mut settings = state.settings.lock().unwrap_or_else(|error| error.into_inner());
    settings.download_dir = resolved.clone();
    persist_settings(&state.settings_path, &settings)?;
    Ok(resolved.unwrap_or_else(|| state.default_dir.clone()))
}

#[tauri::command]
pub async fn pick_download_dir(current: Option<String>) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new();
        if let Some(dir) = current {
            if !dir.trim().is_empty() {
                dialog = dialog.set_directory(dir);
            }
        }
        dialog
            .pick_folder()
            .map(|path| path.to_string_lossy().to_string())
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
pub fn open_download_dir(state: State<'_, DownloadState>) -> Result<(), String> {
    let dir = state.current_dir();
    std::fs::create_dir_all(&dir).map_err(|error| format!("无法创建下载目录: {error}"))?;
    open_dir(Path::new(&dir))
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err("文件不存在".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("打开文件夹失败: {error}"))
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("打开文件夹失败: {error}"))
    }
    #[cfg(target_os = "linux")]
    {
        let dir = path.parent().unwrap_or(&path);
        Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("打开文件夹失败: {error}"))
    }
}

fn open_dir(dir: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(dir)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("打开文件夹失败: {error}"))
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(dir)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("打开文件夹失败: {error}"))
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("打开文件夹失败: {error}"))
    }
}

#[tauri::command]
pub fn cancel_download(state: State<'_, DownloadState>, transfer_id: String) -> bool {
    let active = state.active.lock().unwrap_or_else(|error| error.into_inner());
    if let Some(flag) = active.get(&transfer_id) {
        flag.store(true, Ordering::Relaxed);
        true
    } else {
        false
    }
}

#[tauri::command]
pub async fn save_download(
    app: AppHandle,
    state: State<'_, DownloadState>,
    id: String,
    transfer_id: String,
) -> Result<SavedFile, String> {
    Uuid::parse_str(&id).map_err(|_| "无效的文件 ID".to_string())?;
    Uuid::parse_str(&transfer_id).map_err(|_| "无效的下载任务 ID".to_string())?;

    let cancel = state.register(&transfer_id)?;
    let result = run_save_download(&app, &state, &id, &transfer_id, &cancel).await;
    state.unregister(&transfer_id);
    result
}

async fn run_save_download(
    app: &AppHandle,
    state: &DownloadState,
    id: &str,
    transfer_id: &str,
    cancel: &AtomicBool,
) -> Result<SavedFile, String> {
    let meta_path = state.hub_data_dir.join("meta").join(format!("{id}.json"));
    let source = state.hub_data_dir.join("files").join(format!("{id}.bin"));
    let bytes = tokio::fs::read(&meta_path)
        .await
        .map_err(|error| format!("读取文件信息失败: {error}"))?;
    let meta: Meta = serde_json::from_slice(&bytes)
        .map_err(|error| format!("解析文件信息失败: {error}"))?;

    let target_dir = PathBuf::from(state.current_dir());
    tokio::fs::create_dir_all(&target_dir)
        .await
        .map_err(|error| format!("无法创建下载目录: {error}"))?;

    let safe_name = crate::hub::sanitize_name(&meta.name);
    let (target, existed) = choose_target(&target_dir, &safe_name, meta.size).await?;

    if existed {
        emit_progress(app, transfer_id, meta.size, meta.size, "completed");
        return Ok(SavedFile {
            path: target.to_string_lossy().to_string(),
            existed: true,
        });
    }

    let temp = target_dir.join(format!(".{safe_name}.{transfer_id}.part"));
    let _ = tokio::fs::remove_file(&temp).await;
    emit_progress(app, transfer_id, 0, meta.size, "copying");

    if let Err(error) = copy_to_temp(&source, &temp, meta.size, cancel, app, transfer_id).await {
        let _ = tokio::fs::remove_file(&temp).await;
        let status = if error == "已取消" { "cancelled" } else { "failed" };
        emit_progress(app, transfer_id, 0, meta.size, status);
        return Err(error);
    }

    if let Err(error) = tokio::fs::rename(&temp, &target).await {
        let _ = tokio::fs::remove_file(&temp).await;
        emit_progress(app, transfer_id, meta.size, meta.size, "failed");
        return Err(format!("保存文件失败: {error}"));
    }

    emit_progress(app, transfer_id, meta.size, meta.size, "completed");
    Ok(SavedFile {
        path: target.to_string_lossy().to_string(),
        existed: false,
    })
}
