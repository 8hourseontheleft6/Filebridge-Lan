use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr, UdpSocket},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

const DISCOVERY_PORT: u16 = 42081;
const PEER_TTL: Duration = Duration::from_secs(7);
const BEACON_INTERVAL: Duration = Duration::from_secs(2);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Peer {
    pub id: String,
    pub name: String,
    pub ip: String,
    pub port: u16,
    pub version: String,
    pub url: String,
}

#[derive(Clone, Deserialize, Serialize)]
struct Beacon {
    app: String,
    version: String,
    id: String,
    name: String,
    port: u16,
}

struct PeerRecord {
    id: String,
    name: String,
    ip: String,
    port: u16,
    version: String,
    last_seen: Instant,
}

pub struct DiscoveryState {
    peer_id: String,
    peers: Arc<Mutex<HashMap<String, PeerRecord>>>,
}

fn discovery_port() -> u16 {
    std::env::var("FILEBRIDGE_DISCOVERY_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DISCOVERY_PORT)
}

fn sanitize_name(value: &str) -> String {
    let clean: String = value
        .chars()
        .filter(|ch| !ch.is_control())
        .take(40)
        .collect();
    let clean = clean.trim();
    if clean.is_empty() { "Filebridge-Lan".to_string() } else { clean.to_string() }
}

fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .map(|value| sanitize_name(&value))
        .unwrap_or_else(|_| "Filebridge-Lan".to_string())
}

fn stable_id(data_dir: &Path) -> String {
    let path = data_dir.join("discovery-id");
    if let Ok(value) = std::fs::read_to_string(&path) {
        let value = value.trim();
        if value.len() >= 16 {
            return value.to_string();
        }
    }
    let id = Uuid::new_v4().to_string();
    let _ = std::fs::create_dir_all(data_dir);
    let _ = std::fs::write(path, &id);
    id
}

fn peer_url(ip: &str, port: u16) -> String {
    let host = if ip.contains(':') { format!("[{ip}]") } else { ip.to_string() };
    format!("http://{host}:{port}/")
}

fn parse_beacon(bytes: &[u8], source: SocketAddr, self_id: &str) -> Option<PeerRecord> {
    let beacon: Beacon = serde_json::from_slice(bytes).ok()?;
    if beacon.app != "filebridge-lan" || beacon.id == self_id || beacon.port == 0 {
        return None;
    }
    let name = sanitize_name(&beacon.name);
    let ip = match source.ip() {
        IpAddr::V4(ip) => ip.to_string(),
        IpAddr::V6(ip) => ip.to_string(),
    };
    Some(PeerRecord {
        id: beacon.id,
        name,
        ip,
        port: beacon.port,
        version: sanitize_name(&beacon.version),
        last_seen: Instant::now(),
    })
}

impl DiscoveryState {
    pub fn start(port: u16, data_dir: PathBuf) -> Self {
        let peer_id = stable_id(&data_dir);
        let peers: Arc<Mutex<HashMap<String, PeerRecord>>> = Arc::new(Mutex::new(HashMap::new()));
        let state = Self { peer_id: peer_id.clone(), peers: peers.clone() };
        let name = device_name();
        let version = env!("CARGO_PKG_VERSION").to_string();
        let discovery_port = discovery_port();
        thread::spawn(move || {
            let socket = match UdpSocket::bind(("0.0.0.0", discovery_port)) {
                Ok(socket) => socket,
                Err(error) => {
                    eprintln!("[discovery] UDP {discovery_port} 绑定失败: {error}");
                    return;
                }
            };
            let _ = socket.set_broadcast(true);
            let _ = socket.set_read_timeout(Some(Duration::from_millis(500)));
            let mut buffer = [0u8; 2048];
            let mut last_beacon = Instant::now() - BEACON_INTERVAL;
            loop {
                if last_beacon.elapsed() >= BEACON_INTERVAL {
                    let beacon = Beacon {
                        app: "filebridge-lan".to_string(),
                        version: version.clone(),
                        id: peer_id.clone(),
                        name: name.clone(),
                        port,
                    };
                    if let Ok(payload) = serde_json::to_vec(&beacon) {
                        let _ = socket.send_to(&payload, ("255.255.255.255", discovery_port));
                    }
                    last_beacon = Instant::now();
                }
                match socket.recv_from(&mut buffer) {
                    Ok((size, source)) => {
                        if let Some(record) = parse_beacon(&buffer[..size], source, &peer_id) {
                            let id = record.id.clone();
                            peers.lock().unwrap().insert(id, record);
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock
                        || error.kind() == std::io::ErrorKind::TimedOut => {}
                    Err(_) => thread::sleep(Duration::from_millis(100)),
                }
                let now = Instant::now();
                peers
                    .lock()
                    .unwrap()
                    .retain(|_, peer| now.duration_since(peer.last_seen) <= PEER_TTL);
            }
        });
        state
    }

    pub fn peers(&self) -> Vec<Peer> {
        let now = Instant::now();
        let mut peers = self.peers.lock().unwrap();
        peers.retain(|_, peer| now.duration_since(peer.last_seen) <= PEER_TTL);
        let mut list: Vec<Peer> = peers
            .values()
            .map(|peer| Peer {
                id: peer.id.clone(),
                name: peer.name.clone(),
                ip: peer.ip.clone(),
                port: peer.port,
                version: peer.version.clone(),
                url: peer_url(&peer.ip, peer.port),
            })
            .collect();
        list.sort_by(|a, b| a.name.cmp(&b.name));
        list
    }

    pub fn peer_id(&self) -> &str {
        &self.peer_id
    }
}

#[tauri::command]
pub fn discovery_peers(state: tauri::State<'_, DiscoveryState>) -> Vec<Peer> {
    state.peers()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    #[test]
    fn parse_rejects_wrong_app_and_self() {
        let source = SocketAddr::from((Ipv4Addr::new(192, 168, 1, 8), 42081));
        let valid = br#"{"app":"filebridge-lan","version":"1.5.0","id":"peer-a","name":"DESKTOP-A","port":42080}"#;
        assert!(parse_beacon(valid, source, "peer-b").is_some());
        assert!(parse_beacon(valid, source, "peer-a").is_none());
        let wrong = br#"{"app":"other","version":"1","id":"peer-a","name":"x","port":42080}"#;
        assert!(parse_beacon(wrong, source, "peer-b").is_none());
    }

    #[test]
    fn sanitize_limits_and_falls_back() {
        assert_eq!(sanitize_name("\u{0000}  "), "Filebridge-Lan");
        assert!(sanitize_name(&"x".repeat(100)).len() <= 40);
    }
}
