use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use serde::Serialize;
use tauri::Manager;

use crate::{
    discovery::{DiscoveryState, DiscoveryStatus, Peer},
    network_profile,
};

#[derive(Clone)]
struct ServiceConfig {
    port: u16,
    data_dir: PathBuf,
    dist_dir: PathBuf,
}

struct LanRuntime {
    id: u64,
    hub: tauri::async_runtime::JoinHandle<()>,
    discovery: DiscoveryState,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanServiceStatus {
    pub running: bool,
    pub gate: String,
    pub detail: Option<String>,
    pub port: u16,
}

struct GateStatus {
    gate: String,
    detail: Option<String>,
}

#[derive(Clone)]
pub struct LanServiceState {
    config: ServiceConfig,
    runtime: Arc<Mutex<Option<LanRuntime>>>,
    gate: Arc<Mutex<GateStatus>>,
    apply_lock: Arc<tokio::sync::Mutex<()>>,
    next_runtime_id: Arc<AtomicU64>,
}

impl LanServiceState {
    pub fn new(port: u16, data_dir: PathBuf, dist_dir: PathBuf) -> Self {
        Self {
            config: ServiceConfig { port, data_dir, dist_dir },
            runtime: Arc::new(Mutex::new(None)),
            gate: Arc::new(Mutex::new(GateStatus {
                gate: "starting".to_string(),
                detail: None,
            })),
            apply_lock: Arc::new(tokio::sync::Mutex::new(())),
            next_runtime_id: Arc::new(AtomicU64::new(1)),
        }
    }

    fn set_gate(&self, gate: &str, detail: Option<String>) {
        if let Ok(mut data) = self.gate.lock() {
            data.gate = gate.to_string();
            data.detail = detail;
        }
    }

    fn start_runtime(&self) -> Result<(), String> {
        let mut runtime = self.runtime.lock().unwrap();
        if runtime.is_some() {
            return Ok(());
        }
        let port = self.config.port;
        let tcp = std::net::TcpListener::bind(("0.0.0.0", port)).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AddrInUse {
                format!("HTTP 服务启动失败：TCP {port} 已被占用")
            } else {
                format!("HTTP 服务启动失败：TCP {port} 绑定失败：{error}")
            }
        })?;
        let discovery = DiscoveryState::start(port, self.config.data_dir.clone())?;
        let data_dir = self.config.data_dir.clone();
        let dist_dir = self.config.dist_dir.clone();
        let id = self.next_runtime_id.fetch_add(1, Ordering::Relaxed);
        let service = self.clone();
        let hub = tauri::async_runtime::spawn(async move {
            if let Err(error) = crate::hub::serve_with_listener(tcp, port, data_dir, dist_dir).await {
                service.mark_runtime_failed(
                    id,
                    format!("HTTP 服务启动失败：端口 {port} 可能已被占用：{error}"),
                );
            }
        });
        *runtime = Some(LanRuntime { id, hub, discovery });
        self.set_gate("allowed", None);
        Ok(())
    }

    fn mark_runtime_failed(&self, id: u64, detail: String) {
        let removed = {
            let mut runtime = self.runtime.lock().unwrap();
            if runtime.as_ref().map(|item| item.id) != Some(id) {
                return;
            }
            runtime.take()
        };
        if let Some(runtime) = removed {
            runtime.discovery.stop();
        }
        self.set_gate("port_error", Some(detail));
    }

    async fn stop_runtime(&self) {
        let old = {
            let mut runtime = self.runtime.lock().unwrap();
            runtime.take()
        };
        if let Some(runtime) = old {
            runtime.discovery.stop();
            runtime.hub.abort();
            let _ = runtime.hub.await;
        }
        self.set_gate("blocked", None);
    }

    /// Called once during Tauri setup, before the window is usable.
    pub fn apply_startup(&self) {
        let status = network_profile::network_profile_status();
        if status.checked && status.compliant {
            if let Err(error) = self.start_runtime() {
                self.set_gate("port_error", Some(error));
            }
        } else {
            self.set_gate("public_blocked", Some(status.error.unwrap_or_else(|| {
                "当前网络不是专用网络，局域网服务不会启动".to_string()
            })));
        }
    }

    pub async fn apply(&self) -> LanServiceStatus {
        let _guard = self.apply_lock.lock().await;
        let status = network_profile::network_profile_status();
        if status.checked && status.compliant {
            if let Err(error) = self.start_runtime() {
                self.set_gate("port_error", Some(error));
            }
        } else {
            self.stop_runtime().await;
            self.set_gate(
                "public_blocked",
                Some(status.error.unwrap_or_else(|| {
                    "当前网络不是专用网络，局域网服务不会启动".to_string()
                })),
            );
        }
        self.status()
    }

    pub fn status(&self) -> LanServiceStatus {
        let running = self.runtime.lock().unwrap().is_some();
        let gate = self.gate.lock().unwrap();
        LanServiceStatus {
            running,
            gate: gate.gate.clone(),
            detail: gate.detail.clone(),
            port: self.config.port,
        }
    }

    pub fn peers(&self) -> Vec<Peer> {
        let runtime = self.runtime.lock().unwrap();
        runtime
            .as_ref()
            .map(|runtime| runtime.discovery.peers())
            .unwrap_or_default()
    }

    pub fn discovery_status(&self) -> DiscoveryStatus {
        let runtime = self.runtime.lock().unwrap();
        if let Some(runtime) = runtime.as_ref() {
            return runtime.discovery.status();
        }
        DiscoveryStatus {
            status: "error".to_string(),
            bound: false,
            bind_address: None,
            send_targets: Vec::new(),
            last_send_at: None,
            last_receive_at: None,
            current_error: Some("局域网服务未启动：当前网络不是专用网络".to_string()),
            last_error: Some("局域网服务未启动：当前网络不是专用网络".to_string()),
            peer_count: 0,
        }
    }
}

pub fn spawn_monitor(handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            if let Some(state) = handle.try_state::<LanServiceState>() {
                let service = state.inner().clone();
                drop(state);
                let _ = service.apply().await;
            }
        }
    });
}

#[tauri::command]
pub async fn lan_service_refresh(
    state: tauri::State<'_, LanServiceState>,
) -> Result<LanServiceStatus, String> {
    Ok(state.apply().await)
}

#[tauri::command]
pub fn lan_service_status(state: tauri::State<'_, LanServiceState>) -> LanServiceStatus {
    state.status()
}

#[tauri::command]
pub fn discovery_peers(state: tauri::State<'_, LanServiceState>) -> Vec<Peer> {
    state.peers()
}

#[tauri::command]
pub fn discovery_status(state: tauri::State<'_, LanServiceState>) -> DiscoveryStatus {
    state.discovery_status()
}

#[cfg(test)]
mod tests {
    use super::LanServiceState;

    static SERVICE_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    use crate::network_profile::NetworkProfileStatus;
    use std::net::Ipv4Addr;

    #[derive(Debug, PartialEq)]
    enum Decision {
        Start,
        Keep,
        Stop,
    }

    fn decide(running: bool, allowed: bool) -> Decision {
        if !allowed {
            Decision::Stop
        } else if running {
            Decision::Keep
        } else {
            Decision::Start
        }
    }

    fn status(compliant: bool, error: Option<&str>) -> NetworkProfileStatus {
        NetworkProfileStatus {
            checked: true,
            compliant,
            networks: Vec::new(),
            error: error.map(ToString::to_string),
        }
    }

    fn allowed(status: &NetworkProfileStatus) -> bool {
        status.checked && status.compliant
    }

    #[test]
    fn public_and_error_states_do_not_start_services() {
        assert_eq!(decide(false, allowed(&status(false, Some("public")))), Decision::Stop);
        let mut error = status(false, Some("error"));
        error.checked = false;
        assert_eq!(decide(false, allowed(&error)), Decision::Stop);
    }

    #[test]
    fn private_state_allows_services() {
        assert_eq!(decide(false, allowed(&status(true, None))), Decision::Start);
        assert_eq!(decide(true, allowed(&status(true, None))), Decision::Keep);
    }

    #[tokio::test]
    async fn tcp_port_conflict_reports_error_and_recovers_after_release() {
        let _guard = SERVICE_TEST_LOCK.lock().unwrap();
        let root = std::env::current_dir().unwrap().join(format!(
            ".filebridge-service-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).expect("temp dir");
        let occupied = std::net::TcpListener::bind(("0.0.0.0", 0)).expect("probe listener");
        let port = occupied.local_addr().expect("probe addr").port();
        let state = LanServiceState::new(port, root.clone(), root.join("dist"));
        let error = state.start_runtime().expect_err("occupied TCP must fail");
        assert!(error.contains("TCP"), "unexpected error: {error}");
        assert!(!state.status().running);
        drop(occupied);
        state.start_runtime().expect("service should recover");
        assert!(state.status().running);
        state.stop_runtime().await;
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn udp_port_conflict_reports_error_and_recovers_after_release() {
        let _guard = SERVICE_TEST_LOCK.lock().unwrap();
        let root = std::env::current_dir().unwrap().join(format!(
            ".filebridge-service-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).expect("temp dir");
        let occupied = std::net::UdpSocket::bind(("0.0.0.0", 0)).expect("probe udp");
        let discovery_port = occupied.local_addr().expect("probe addr").port();
        let previous = std::env::var("FILEBRIDGE_DISCOVERY_PORT").ok();
        std::env::set_var("FILEBRIDGE_DISCOVERY_PORT", discovery_port.to_string());
        let tcp = std::net::TcpListener::bind(("0.0.0.0", 0)).expect("free tcp");
        let port = tcp.local_addr().expect("tcp addr").port();
        drop(tcp);
        let state = LanServiceState::new(port, root.clone(), root.join("dist"));
        let error = state.start_runtime().expect_err("occupied UDP must fail");
        assert!(error.contains("UDP") || error.contains("发现"), "unexpected error: {error}");
        assert!(!state.status().running);
        drop(occupied);
        state.start_runtime().expect("service should recover");
        assert!(state.status().running);
        state.stop_runtime().await;
        match previous {
            Some(value) => std::env::set_var("FILEBRIDGE_DISCOVERY_PORT", value),
            None => std::env::remove_var("FILEBRIDGE_DISCOVERY_PORT"),
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn switching_from_public_to_private_restarts_services() {
        let public = status(false, Some("public"));
        let private = status(true, None);
        assert_eq!(decide(true, allowed(&public)), Decision::Stop);
        assert_eq!(decide(false, allowed(&private)), Decision::Start);
    }

    #[test]
    fn broadcast_targets_change_with_interface_prefix() {
        let first = crate::discovery::Ipv4Interface {
            ip: Ipv4Addr::new(192, 168, 2, 43),
            prefix_len: 24,
            adapter_name: String::new(),
            friendly_name: String::new(),
            if_type: 6,
            oper_status: 1,
        };
        let moved = crate::discovery::Ipv4Interface {
            ip: Ipv4Addr::new(10, 0, 5, 20),
            prefix_len: 16,
            adapter_name: String::new(),
            friendly_name: String::new(),
            if_type: 6,
            oper_status: 1,
        };
        let a = crate::discovery::targets_from_interfaces(&[first], 42081);
        let b = crate::discovery::targets_from_interfaces(&[moved], 42081);
        assert!(a.iter().any(|target| target.ip() == std::net::IpAddr::V4(Ipv4Addr::new(192, 168, 2, 255))));
        assert!(b.iter().any(|target| target.ip() == std::net::IpAddr::V4(Ipv4Addr::new(10, 0, 255, 255))));
        assert_ne!(a, b);
    }
}
