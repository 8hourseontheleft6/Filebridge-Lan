pub mod discovery;
pub mod downloads;
pub mod hub;
pub mod lan_service;
pub mod network_profile;

use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

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

#[cfg(windows)]
fn configure_webrtc_webview2() {
    // WebView2 默认用 mDNS 隐藏 host ICE 候选（xxx.local）。
    // iPhone/Safari 以及部分路由器无法解析 mDNS，房间会一直停在 connecting。
    // 显式暴露局域网 IP 候选；仅在专用/域网络的防火墙规则下使用。
    const FLAG: &str = "--disable-features=WebRtcHideLocalIpsWithMdns";
    let current = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
    if current.contains("WebRtcHideLocalIpsWithMdns") {
        return;
    }
    let next = if current.trim().is_empty() {
        FLAG.to_string()
    } else {
        format!("{current} {FLAG}")
    };
    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", next);
}

#[cfg(not(windows))]
fn configure_webrtc_webview2() {}

#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    const PROJECT_URL: &str = "https://github.com/8hourseontheleft6/Filebridge-Lan";
    if url != PROJECT_URL {
        return Err("不允许打开这个链接".to_string());
    }
    app.shell()
        .open(url, None)
        .map_err(|error| format!("打开链接失败：{error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_webrtc_webview2();

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
            lan_service::lan_service_refresh,
            lan_service::lan_service_status,
            lan_service::discovery_peers,
            lan_service::discovery_status,
            network_profile::network_profile_status,
            open_external,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = resolve_data_dir(&handle);
            let dist_dir = resolve_dist(&handle);
            let port: u16 = std::env::var("FILEBRIDGE_LAN_HUB_PORT")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(42080);
            let lan_service = lan_service::LanServiceState::new(port, data_dir.clone(), dist_dir);
            lan_service.apply_startup();
            app.manage(lan_service);
            let default_download_dir = handle
                .path()
                .download_dir()
                .unwrap_or_else(|_| data_dir.join("downloads"));
            app.manage(downloads::DownloadState::new(
                data_dir.clone(),
                default_download_dir,
            ));

            lan_service::spawn_monitor(handle);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 Filebridge-Lan 失败");
}
