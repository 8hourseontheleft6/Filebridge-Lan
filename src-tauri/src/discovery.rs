use std::{
    collections::HashMap,
    net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

const DISCOVERY_PORT: u16 = 42081;
const PEER_TTL: Duration = Duration::from_secs(7);
const BEACON_INTERVAL: Duration = Duration::from_secs(2);
const TARGET_REFRESH: Duration = Duration::from_secs(5);

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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryStatus {
    pub status: String,
    pub bound: bool,
    pub bind_address: Option<String>,
    pub send_targets: Vec<String>,
    pub last_send_at: Option<u64>,
    pub last_receive_at: Option<u64>,
    pub current_error: Option<String>,
    pub last_error: Option<String>,
    pub peer_count: usize,
}

#[derive(Clone, Deserialize, Serialize)]
struct Beacon {
    app: String,
    version: String,
    id: String,
    name: String,
    port: u16,
}

#[derive(Clone)]
pub(crate) struct Ipv4Interface {
    pub ip: Ipv4Addr,
    pub prefix_len: u8,
    pub adapter_name: String,
    pub friendly_name: String,
    pub if_type: u32,
    pub oper_status: u32,
}

struct PeerRecord {
    id: String,
    name: String,
    ip: String,
    port: u16,
    version: String,
    last_seen: Instant,
}

struct StatusData {
    status: String,
    bound: bool,
    bind_address: Option<String>,
    send_targets: Vec<SocketAddr>,
    last_send_at: Option<u64>,
    last_receive_at: Option<u64>,
    current_error: Option<String>,
    last_error: Option<String>,
}

pub struct DiscoveryState {
    peers: Arc<Mutex<HashMap<String, PeerRecord>>>,
    status: Arc<Mutex<StatusData>>,
    stop: Arc<AtomicBool>,
    thread: Mutex<Option<thread::JoinHandle<()>>>,
}

fn discovery_port() -> u16 {
    std::env::var("FILEBRIDGE_DISCOVERY_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DISCOVERY_PORT)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
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

/// /0 and /31+ do not have a usable traditional broadcast address.
/// /31 is point-to-point (RFC 3021); /32 is a single host.
fn directed_broadcast(ip: Ipv4Addr, prefix_len: u8) -> Option<Ipv4Addr> {
    if prefix_len == 0 || prefix_len >= 31 {
        return None;
    }
    let mask = u32::MAX << (32 - prefix_len);
    let broadcast = (u32::from(ip) & mask) | !mask;
    Some(Ipv4Addr::from(broadcast))
}

pub(crate) fn targets_from_interfaces(interfaces: &[Ipv4Interface], port: u16) -> Vec<SocketAddr> {
    let mut targets = vec![
        SocketAddr::from((Ipv4Addr::new(255, 255, 255, 255), port)),
    ];
    for interface in interfaces {
        if interface.ip.is_loopback()
            || interface.ip.is_unspecified()
            || interface.ip.is_link_local()
        {
            continue;
        }
        let Some(broadcast) = directed_broadcast(interface.ip, interface.prefix_len) else {
            continue;
        };
        let target = SocketAddr::from((broadcast, port));
        if !targets.contains(&target) {
            targets.push(target);
        }
    }
    targets
}

fn build_targets(port: u16) -> (Vec<SocketAddr>, Option<String>) {
    let mut targets = vec![
        SocketAddr::from((Ipv4Addr::new(255, 255, 255, 255), port)),
    ];
    match ipv4_interfaces() {
        Ok(interfaces) => {
            for target in targets_from_interfaces(&interfaces, port) {
                if !targets.contains(&target) {
                    targets.push(target);
                }
            }
            (targets, None)
        }
        Err(error) => (targets, Some(format!("枚举网络接口失败：{error}"))),
    }
}

#[cfg(windows)]
fn pstr_to_string(value: windows_sys::core::PSTR) -> String {
    if value.is_null() {
        return String::new();
    }
    unsafe { std::ffi::CStr::from_ptr(value as *const i8) }
        .to_string_lossy()
        .into_owned()
}

#[cfg(windows)]
fn pwstr_to_string(value: windows_sys::core::PWSTR) -> String {
    if value.is_null() {
        return String::new();
    }
    let mut len = 0usize;
    unsafe {
        while *value.add(len) != 0 {
            len += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(value, len))
    }
}

#[cfg(windows)]
pub(crate) fn ipv4_interfaces() -> Result<Vec<Ipv4Interface>, String> {
    use std::ptr;

    use windows_sys::Win32::Foundation::{ERROR_BUFFER_OVERFLOW, ERROR_SUCCESS};
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetAdaptersAddresses, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER,
        GAA_FLAG_SKIP_MULTICAST, IP_ADAPTER_ADDRESSES_LH,
    };
    use windows_sys::Win32::Networking::WinSock::{AF_INET, SOCKADDR_IN};

    let flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;
    let mut size: u32 = 15_000;
    let mut buffer: Vec<usize>;

    loop {
        let words = (size as usize).div_ceil(std::mem::size_of::<usize>()).max(1);
        buffer = vec![0usize; words];
        let result = unsafe {
            GetAdaptersAddresses(
                AF_INET as u32,
                flags,
                ptr::null(),
                buffer.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH,
                &mut size,
            )
        };
        if result == ERROR_BUFFER_OVERFLOW {
            continue;
        }
        if result != ERROR_SUCCESS {
            return Err(format!("GetAdaptersAddresses 返回错误 {result}"));
        }
        break;
    }

    let mut interfaces = Vec::new();
    let mut adapter = buffer.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
    while !adapter.is_null() {
        let current = unsafe { &*adapter };
        let mut unicast = current.FirstUnicastAddress;
        while !unicast.is_null() {
            let item = unsafe { &*unicast };
            let sockaddr = item.Address.lpSockaddr;
            if !sockaddr.is_null() && unsafe { (*sockaddr).sa_family } == AF_INET {
                let sin = unsafe { &*(sockaddr.cast::<SOCKADDR_IN>()) };
                let octets = unsafe { sin.sin_addr.S_un.S_un_b };
                let ip = Ipv4Addr::new(octets.s_b1, octets.s_b2, octets.s_b3, octets.s_b4);
                if !ip.is_loopback() && !ip.is_unspecified() {
                    interfaces.push(Ipv4Interface {
                        ip,
                        prefix_len: item.OnLinkPrefixLength,
                        adapter_name: pstr_to_string(current.AdapterName),
                        friendly_name: pwstr_to_string(current.FriendlyName),
                        if_type: current.IfType,
                        oper_status: current.OperStatus as u32,
                    });
                }
            }
            unicast = item.Next;
        }
        adapter = current.Next;
    }
    Ok(interfaces)
}

#[cfg(not(windows))]
pub(crate) fn ipv4_interfaces() -> Result<Vec<Ipv4Interface>, String> {
    // The desktop application currently targets Windows. Non-Windows builds
    // retain the global broadcast target and do not guess a subnet mask.
    Ok(Vec::new())
}

fn record_error(status: &Arc<Mutex<StatusData>>, message: String) {
    if let Ok(mut data) = status.lock() {
        data.current_error = Some(message.clone());
        data.last_error = Some(message);
    }
}

impl DiscoveryState {
    pub fn start(port: u16, data_dir: PathBuf) -> Self {
        let peer_id = stable_id(&data_dir);
        let peers: Arc<Mutex<HashMap<String, PeerRecord>>> = Arc::new(Mutex::new(HashMap::new()));
        let discovery_port = discovery_port();
        let (targets, interface_error) = build_targets(discovery_port);
        let status = Arc::new(Mutex::new(StatusData {
            status: "starting".to_string(),
            bound: false,
            bind_address: None,
            send_targets: targets.clone(),
            last_send_at: None,
            last_receive_at: None,
            current_error: interface_error.clone(),
            last_error: interface_error,
        }));
        let stop = Arc::new(AtomicBool::new(false));
        let state = Self {
            peers: peers.clone(),
            status: status.clone(),
            stop: stop.clone(),
            thread: Mutex::new(None),
        };
        let name = device_name();
        let version = env!("CARGO_PKG_VERSION").to_string();
        let thread_stop = stop.clone();

        let handle = thread::spawn(move || {
            let socket = match UdpSocket::bind(("0.0.0.0", discovery_port)) {
                Ok(socket) => socket,
                Err(error) => {
                    let message = if error.kind() == std::io::ErrorKind::AddrInUse {
                        format!("发现服务启动失败：端口 {discovery_port} 已被占用")
                    } else {
                        format!("发现服务启动失败：UDP {discovery_port} 绑定失败：{error}")
                    };
                    if let Ok(mut data) = status.lock() {
                        data.status = "error".to_string();
                        data.bound = false;
                        data.current_error = Some(message.clone());
                        data.last_error = Some(message);
                    }
                    return;
                }
            };

            if let Ok(mut data) = status.lock() {
                data.status = "listening".to_string();
                data.bound = true;
                data.bind_address = Some(format!("0.0.0.0:{discovery_port}"));
            }

            if let Err(error) = socket.set_broadcast(true) {
                record_error(&status, format!("启用 UDP 广播失败：{error}"));
            }
            if let Err(error) = socket.set_read_timeout(Some(Duration::from_millis(500))) {
                record_error(&status, format!("设置 UDP 读取超时失败：{error}"));
                if let Ok(mut data) = status.lock() {
                    data.status = "error".to_string();
                }
                return;
            }

            let mut buffer = [0u8; 2048];
            let mut targets = targets;
            let mut last_beacon = Instant::now() - BEACON_INTERVAL;
            let mut last_target_refresh = Instant::now();
            loop {
                if thread_stop.load(Ordering::Relaxed) {
                    break;
                }

                if last_target_refresh.elapsed() >= TARGET_REFRESH {
                    let (next_targets, interface_error) = build_targets(discovery_port);
                    if let Some(error) = interface_error {
                        record_error(&status, error);
                    } else if next_targets != targets {
                        targets = next_targets;
                        if let Ok(mut data) = status.lock() {
                            data.send_targets = targets.clone();
                            data.current_error = None;
                        }
                    }
                    last_target_refresh = Instant::now();
                }

                if last_beacon.elapsed() >= BEACON_INTERVAL {
                    let beacon = Beacon {
                        app: "filebridge-lan".to_string(),
                        version: version.clone(),
                        id: peer_id.clone(),
                        name: name.clone(),
                        port,
                    };
                    if let Ok(payload) = serde_json::to_vec(&beacon) {
                        let mut sent = false;
                        for target in &targets {
                            match socket.send_to(&payload, target) {
                                Ok(_) => sent = true,
                                Err(error) => {
                                    record_error(&status, format!("发送到 {target} 失败：{error}"));
                                }
                            }
                        }
                        if sent {
                            if let Ok(mut data) = status.lock() {
                                data.last_send_at = Some(now_ms());
                                data.current_error = None;
                            }
                        }
                    }
                    last_beacon = Instant::now();
                }

                match socket.recv_from(&mut buffer) {
                    Ok((size, source)) => {
                        if let Some(record) = parse_beacon(&buffer[..size], source, &peer_id) {
                            let id = record.id.clone();
                            if let Ok(mut peers) = peers.lock() {
                                peers.insert(id, record);
                            }
                            if let Ok(mut data) = status.lock() {
                                data.last_receive_at = Some(now_ms());
                                data.current_error = None;
                            }
                        }
                    }
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            || error.kind() == std::io::ErrorKind::TimedOut => {}
                    Err(error) => {
                        record_error(&status, format!("接收 UDP 数据失败：{error}"));
                        thread::sleep(Duration::from_millis(100));
                    }
                }

                let now = Instant::now();
                if let Ok(mut peers) = peers.lock() {
                    peers.retain(|_, peer| now.duration_since(peer.last_seen) <= PEER_TTL);
                }

                if thread_stop.load(Ordering::Relaxed) {
                    break;
                }
            }
        });
        *state.thread.lock().unwrap() = Some(handle);

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

    pub fn status(&self) -> DiscoveryStatus {
        // Lock peers first: the discovery thread also updates peers before status.
        let now = Instant::now();
        let mut peers = self.peers.lock().unwrap();
        peers.retain(|_, peer| now.duration_since(peer.last_seen) <= PEER_TTL);
        let peer_count = peers.len();
        let data = self.status.lock().unwrap();
        DiscoveryStatus {
            status: data.status.clone(),
            bound: data.bound,
            bind_address: data.bind_address.clone(),
            send_targets: data.send_targets.iter().map(ToString::to_string).collect(),
            last_send_at: data.last_send_at,
            last_receive_at: data.last_receive_at,
            current_error: data.current_error.clone(),
            last_error: data.last_error.clone(),
            peer_count,
        }
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Ok(mut thread) = self.thread.lock() {
            if let Some(handle) = thread.take() {
                let _ = handle.join();
            }
        }
    }
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

    #[test]
    fn peer_url_handles_ipv4_and_ipv6() {
        assert_eq!(peer_url("192.168.1.8", 42080), "http://192.168.1.8:42080/");
        assert_eq!(peer_url("fe80::1", 42080), "http://[fe80::1]:42080/");
    }

    #[test]
    fn directed_broadcast_supports_common_prefixes() {
        assert_eq!(
            directed_broadcast(Ipv4Addr::new(192, 168, 2, 43), 24),
            Some(Ipv4Addr::new(192, 168, 2, 255))
        );
        assert_eq!(
            directed_broadcast(Ipv4Addr::new(192, 168, 2, 43), 16),
            Some(Ipv4Addr::new(192, 168, 255, 255))
        );
        assert_eq!(directed_broadcast(Ipv4Addr::new(192, 168, 2, 43), 31), None);
        assert_eq!(directed_broadcast(Ipv4Addr::new(192, 168, 2, 43), 32), None);
        assert_eq!(directed_broadcast(Ipv4Addr::new(192, 168, 2, 43), 33), None);
        assert_eq!(directed_broadcast(Ipv4Addr::new(192, 168, 2, 43), 0), None);
    }

    #[test]
    fn targets_include_global_and_directed_and_skip_invalid() {
        fn iface(ip: [u8; 4], prefix_len: u8) -> Ipv4Interface {
            Ipv4Interface {
                ip: Ipv4Addr::from(ip),
                prefix_len,
                adapter_name: String::new(),
                friendly_name: String::new(),
                if_type: 6,
                oper_status: 1,
            }
        }
        let interfaces = vec![
            iface([192, 168, 2, 43], 24),
            iface([192, 168, 2, 44], 24),
            iface([127, 0, 0, 1], 8),
            iface([169, 254, 1, 2], 16),
            iface([10, 0, 0, 8], 31),
        ];
        let targets = targets_from_interfaces(&interfaces, 42081);
        assert_eq!(targets.len(), 2);
        assert!(targets.contains(&SocketAddr::from((Ipv4Addr::new(255, 255, 255, 255), 42081))));
        assert!(targets.contains(&SocketAddr::from((Ipv4Addr::new(192, 168, 2, 255), 42081))));
    }

    #[test]
    fn beacon_payload_has_only_discovery_fields() {
        let beacon = Beacon {
            app: "filebridge-lan".to_string(),
            version: "1.5.0".to_string(),
            id: "peer-a".to_string(),
            name: "DESKTOP-A".to_string(),
            port: 42080,
        };
        let value = serde_json::to_value(beacon).unwrap();
        let object = value.as_object().unwrap();
        let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["app", "id", "name", "port", "version"]);
    }
}
