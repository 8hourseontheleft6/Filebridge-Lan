pub mod downloads;
pub mod hub;
pub mod signaling;

use std::path::PathBuf;
use tauri::Manager;

fn resolve_dist(app: &tauri::AppHandle) -> PathBuf {
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist");

    // 开发构建优先用最新 dist；release 构建优先用打包进 resources 的 dist
    #[cfg(debug_assertions)]
    {
        if dev.join("index.html").exists() {
            return dev;
        }
    }

    if let Ok(resource) = app.path().resource_dir() {
        for candidate in [resource.join("dist"), resource.join("_up_/dist")] {
            if candidate.join("index.html").exists() {
                return candidate;
            }
        }
    }

    dev
}

fn resolve_data_dir(app: &tauri::AppHandle) -> PathBuf {
    let base = app
        .path()
        .download_dir()
        .or_else(|_| app.path().app_data_dir())
        .unwrap_or_else(|_| std::env::temp_dir());
    let current = base.join("Filebridge-Lan");
    let legacy = base.join("FileBridge");

    // 1.2.0 改名迁移：优先复用旧 FileBridge 数据目录，避免用户文件丢失。
    if !current.exists() && legacy.exists() {
        match std::fs::rename(&legacy, &current) {
            Ok(()) => return current,
            Err(error) => {
                eprintln!("[app] 迁移旧数据目录失败，继续使用 FileBridge/: {error}");
                return legacy;
            }
        }
    }

    current
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            downloads::get_download_dir,
            downloads::default_download_dir,
            downloads::set_download_dir,
            downloads::pick_download_dir,
            downloads::open_download_dir,
            downloads::save_download,
            downloads::cancel_download,
            downloads::open_path,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = resolve_data_dir(&handle);
            let dist_dir = resolve_dist(&handle);
            let default_download_dir = handle
                .path()
                .download_dir()
                .unwrap_or_else(|_| data_dir.join("downloads"));
            app.manage(downloads::DownloadState::new(
                data_dir.clone(),
                default_download_dir,
            ));

            tauri::async_runtime::spawn(async move {
                let port: u16 = std::env::var("FILEBRIDGE_LAN_HUB_PORT")
                    .ok()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(42080);

                if let Err(error) = hub::serve(port, data_dir, dist_dir).await {
                    eprintln!("[hub] 启动失败（端口 {port} 可能已被占用）: {error}");
                }
            });

            tauri::async_runtime::spawn(async move {
                let port: u16 = std::env::var("FILEBRIDGE_LAN_SIGNAL_PORT")
                    .ok()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(42070);
                if let Err(error) = signaling::serve(port).await {
                    eprintln!("[signal] 启动失败（端口 {port} 可能已被占用）: {error}");
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 Filebridge-Lan 失败");
}
