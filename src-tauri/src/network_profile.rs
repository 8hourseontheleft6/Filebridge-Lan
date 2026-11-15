use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::discovery::Ipv4Interface;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkProfile {
    pub name: String,
    pub category: String,
    pub label: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkProfileStatus {
    pub checked: bool,
    pub compliant: bool,
    pub networks: Vec<NetworkProfile>,
    pub error: Option<String>,
}

/// Result of picking the interfaces that can carry the LAN service.
pub(crate) enum NetworkSelection {
    /// Real adapters only; the caller classifies their Windows network profile.
    Usable(Vec<NetworkProfile>),
    /// Nothing safe to bind: only virtual adapters, or no connected private IPv4.
    NoUsableInterface(String),
}

fn classify(networks: &[NetworkProfile]) -> (bool, Option<String>) {
    if networks.is_empty() {
        return (false, Some("未检测到已连接的专用网络".to_string()));
    }
    let unsupported: Vec<&NetworkProfile> = networks
        .iter()
        .filter(|network| !matches!(network.category.as_str(), "private" | "domain"))
        .collect();
    if !unsupported.is_empty() {
        let names = unsupported
            .iter()
            .map(|network| network.name.as_str())
            .collect::<Vec<_>>()
            .join("、");
        return (false, Some(format!("检测到非专用网络：{names}")));
    }
    (true, None)
}

fn normalize_key(value: &str) -> String {
    value
        .trim()
        .trim_matches(|ch| ch == '{' || ch == '}')
        .replace('-', "")
        .to_ascii_lowercase()
}

fn is_private_ipv4(ip: std::net::Ipv4Addr) -> bool {
    ip.is_private()
}

/// Markers found in the driver description or the adapter name of virtual NICs.
///
/// The description comes from the driver (`GetAdaptersAddresses::Description`),
/// so it keeps naming the virtual driver even when Windows renames the adapter
/// to "以太网 2" / "Ethernet 2" in a localized way.
const VIRTUAL_ADAPTER_MARKERS: &[&str] = &[
    "virtualbox",
    "vbox",
    "vmware",
    "vmnet",
    "hyper-v",
    "vethernet",
    "wsl",
    "virtual ethernet",
    "host-only",
    "wi-fi direct",
    "wifi direct",
    "microsoft wi-fi direct",
    "tap-windows",
    "tap-win32",
    "tap adapter",
    "openvpn",
    "wireguard",
    "tailscale",
    "zerotier",
    "npcap",
    "hamachi",
    "radmin",
    "softether",
    "pseudo-interface",
    "teredo",
    "isatap",
    "6to4",
    "loopback",
    "bluetooth",
    "docker",
    "wintun",
    "vpn",
    "tunnel",
    "tap",
];

/// Virtual NIC vendors, recognised by the locally administered MAC prefixes they
/// are shipped with. This is a second, locale-independent signal in case a driver
/// description is missing or renamed.
const VIRTUAL_MAC_PREFIXES: &[&[u8]] = &[
    &[0x0a, 0x00, 0x27], // VirtualBox host-only / NAT
    &[0x00, 0x15, 0x5d], // Hyper-V
    &[0x00, 0x50, 0x56], // VMware
    &[0x00, 0x0c, 0x29], // VMware
    &[0x00, 0x05, 0x69], // VMware
    &[0x00, 0x1c, 0x14], // VMware
    &[0x00, 0x1c, 0x42], // Parallels
    &[0x00, 0x16, 0x3e], // Xen
    &[0x52, 0x54, 0x00], // QEMU / KVM
    &[0x00, 0xff],       // TAP-Windows / OpenVPN
    &[0x02, 0x42],       // Docker bridge
];

fn matches_virtual_marker(value: &str) -> bool {
    if value.is_empty() {
        return false;
    }
    let value = value.to_ascii_lowercase();
    VIRTUAL_ADAPTER_MARKERS
        .iter()
        .any(|marker| value.contains(marker))
}

fn has_virtual_mac(mac: &Option<[u8; 6]>) -> bool {
    let Some(mac) = mac else { return false };
    VIRTUAL_MAC_PREFIXES
        .iter()
        .any(|prefix| mac.starts_with(prefix))
}

/// A virtual adapter must never be treated as the real LAN carrier, whatever
/// Windows decided to call it.
fn is_virtual_adapter(interface: &Ipv4Interface) -> bool {
    matches_virtual_marker(&interface.friendly_name)
        || matches_virtual_marker(&interface.adapter_description)
        || has_virtual_mac(&interface.mac)
}

fn is_physical_if_type(if_type: u32) -> bool {
    // IF_TYPE_ETHERNET_CSMACD = 6, IF_TYPE_IEEE80211 = 71
    matches!(if_type, 6 | 71)
}

/// Pick the interfaces that may carry the LAN service.
///
/// Rules, in order:
/// 1. only up adapters with a private IPv4 address, skipping loopback/tunnel types;
/// 2. drop every known virtual adapter — and never fall back to them afterwards;
/// 3. prefer real Ethernet/Wi-Fi, keeping other *physical* types if none match;
/// 4. map what is left to its Windows network profile.
pub(crate) fn select_networks(
    interfaces: &[Ipv4Interface],
    profiles: &HashMap<String, NetworkProfile>,
) -> NetworkSelection {
    let connected: Vec<&Ipv4Interface> = interfaces
        .iter()
        .filter(|interface| {
            interface.oper_status == 1
                && is_private_ipv4(interface.ip)
                && interface.if_type != 24
                && interface.if_type != 131
        })
        .collect();

    if connected.is_empty() {
        return NetworkSelection::NoUsableInterface("未检测到已连接的专用网络".to_string());
    }

    let physical: Vec<&Ipv4Interface> = connected
        .into_iter()
        .filter(|interface| !is_virtual_adapter(interface))
        .collect();
    if physical.is_empty() {
        return NetworkSelection::NoUsableInterface(
            "只检测到虚拟网卡，已暂停局域网服务；请连接真实 Wi-Fi 或以太网".to_string(),
        );
    }

    let typed: Vec<&Ipv4Interface> = physical
        .iter()
        .copied()
        .filter(|interface| is_physical_if_type(interface.if_type))
        .collect();
    let selected = if typed.is_empty() { physical } else { typed };

    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for interface in selected {
        let key = normalize_key(&interface.adapter_name);
        let profile = profiles
            .get(&key)
            .cloned()
            .unwrap_or_else(|| NetworkProfile {
                name: if interface.friendly_name.is_empty() {
                    interface.ip.to_string()
                } else {
                    interface.friendly_name.clone()
                },
                category: "unknown".to_string(),
                label: "未知网络".to_string(),
            });
        let identity = (profile.name.clone(), profile.category.clone());
        if seen.insert(identity) {
            result.push(profile);
        }
    }

    NetworkSelection::Usable(result)
}

/// Turn the selection into the status the UI consumes.
pub(crate) fn evaluate(
    interfaces: &[Ipv4Interface],
    profiles: &HashMap<String, NetworkProfile>,
) -> NetworkProfileStatus {
    match select_networks(interfaces, profiles) {
        NetworkSelection::Usable(networks) => {
            let (compliant, error) = classify(&networks);
            NetworkProfileStatus {
                checked: true,
                compliant,
                networks,
                error,
            }
        }
        NetworkSelection::NoUsableInterface(error) => NetworkProfileStatus {
            checked: true,
            compliant: false,
            networks: Vec::new(),
            error: Some(error),
        },
    }
}

#[cfg(windows)]
fn read_network_connections() -> Result<HashMap<String, NetworkProfile>, String> {
    use windows::core::IUnknown;
    use windows::Win32::Networking::NetworkListManager::{
        INetworkConnection, INetworkListManager, NetworkListManager,
        NLM_NETWORK_CATEGORY_DOMAIN_AUTHENTICATED, NLM_NETWORK_CATEGORY_PRIVATE,
        NLM_NETWORK_CATEGORY_PUBLIC,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };

    let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok() };
    let result = (|| {
        let manager: INetworkListManager = unsafe {
            CoCreateInstance(&NetworkListManager, None::<&IUnknown>, CLSCTX_ALL)
        }
        .map_err(|error| format!("创建 NetworkListManager 失败：{error}"))?;

        let connections = unsafe { manager.GetNetworkConnections() }
            .map_err(|error| format!("读取网络连接失败：{error}"))?;
        let mut profiles = HashMap::new();
        loop {
            let mut item: Option<INetworkConnection> = None;
            let mut fetched = 0u32;
            if let Err(error) = unsafe {
                connections.Next(std::slice::from_mut(&mut item), Some(&mut fetched))
            } {
                return Err(format!("遍历网络连接失败：{error}"));
            }
            if fetched == 0 {
                break;
            }
            let Some(connection) = item else { break };
            let adapter_id = unsafe { connection.GetAdapterId() }
                .map_err(|error| format!("读取网络适配器 ID 失败：{error}"))?;
            let network = unsafe { connection.GetNetwork() }
                .map_err(|error| format!("读取网络配置失败：{error}"))?;
            let name = unsafe { network.GetName() }
                .map(|value| value.to_string())
                .unwrap_or_else(|_| "未命名网络".to_string());
            let category = unsafe { network.GetCategory() }
                .map_err(|error| format!("读取网络类型失败：{error}"))?;
            let (category, label) = if category == NLM_NETWORK_CATEGORY_PUBLIC {
                ("public", "公用网络")
            } else if category == NLM_NETWORK_CATEGORY_PRIVATE {
                ("private", "专用网络")
            } else if category == NLM_NETWORK_CATEGORY_DOMAIN_AUTHENTICATED {
                ("domain", "域网络")
            } else {
                ("unknown", "未知网络")
            };
            profiles.insert(
                normalize_key(&format!("{adapter_id:?}")),
                NetworkProfile {
                    name,
                    category: category.to_string(),
                    label: label.to_string(),
                },
            );
        }
        Ok(profiles)
    })();

    if initialized {
        unsafe { CoUninitialize() };
    }
    result
}

#[cfg(not(windows))]
fn read_network_connections() -> Result<HashMap<String, NetworkProfile>, String> {
    Err("网络类型检测仅支持 Windows".to_string())
}

fn read_profiles() -> Result<NetworkProfileStatus, String> {
    let profiles = read_network_connections()?;
    let interfaces = crate::discovery::ipv4_interfaces()?;
    Ok(evaluate(&interfaces, &profiles))
}

fn failed_status(error: String) -> NetworkProfileStatus {
    NetworkProfileStatus {
        checked: false,
        compliant: false,
        networks: Vec::new(),
        error: Some(error),
    }
}

#[tauri::command]
pub fn network_profile_status() -> NetworkProfileStatus {
    // NetworkListManager is COM-based. Run it on a fresh thread so the
    // WebView2/UI thread's COM apartment mode cannot interfere.
    let result = std::thread::spawn(read_profiles)
        .join()
        .map_err(|_| "网络类型检测线程异常退出".to_string());
    match result {
        Ok(Ok(status)) => status,
        Ok(Err(error)) => failed_status(error),
        Err(error) => failed_status(error),
    }
}

#[cfg(test)]
mod tests {
    use std::net::Ipv4Addr;

    use super::*;

    fn profile(name: &str, category: &str) -> NetworkProfile {
        NetworkProfile {
            name: name.to_string(),
            category: category.to_string(),
            label: category.to_string(),
        }
    }

    fn adapter(
        ip: [u8; 4],
        friendly_name: &str,
        description: &str,
        if_type: u32,
        mac: Option<[u8; 6]>,
    ) -> Ipv4Interface {
        Ipv4Interface {
            ip: Ipv4Addr::from(ip),
            prefix_len: 24,
            adapter_name: format!("{{{friendly_name}}}"),
            friendly_name: friendly_name.to_string(),
            adapter_description: description.to_string(),
            mac,
            if_type,
            oper_status: 1,
        }
    }

    fn wifi() -> Ipv4Interface {
        adapter(
            [192, 168, 2, 51],
            "WLAN",
            "MediaTek Wi-Fi 6E MT7922 (RZ616) 160MHz PCIe Adapter",
            71,
            Some([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]),
        )
    }

    fn ethernet() -> Ipv4Interface {
        adapter(
            [192, 168, 2, 52],
            "以太网",
            "Realtek PCIe GbE Family Controller",
            6,
            Some([0x11, 0x22, 0x33, 0x44, 0x55, 0x67]),
        )
    }

    fn virtualbox_host_only() -> Ipv4Interface {
        adapter(
            [192, 168, 56, 1],
            "以太网 2",
            "VirtualBox Host-Only Ethernet Adapter",
            6,
            Some([0x0a, 0x00, 0x27, 0x00, 0x00, 0x01]),
        )
    }

    fn profiles_for(pairs: &[(&Ipv4Interface, &str, &str)]) -> HashMap<String, NetworkProfile> {
        pairs
            .iter()
            .map(|(interface, name, category)| {
                (normalize_key(&interface.adapter_name), profile(name, category))
            })
            .collect()
    }

    #[test]
    fn private_and_domain_are_compliant() {
        assert_eq!(
            classify(&[profile("Wi-Fi", "private"), profile("Ethernet", "domain")]),
            (true, None)
        );
    }

    #[test]
    fn public_is_not_compliant() {
        let (ok, error) = classify(&[profile("Wi-Fi", "private"), profile("Q", "public")]);
        assert!(!ok);
        assert!(error.unwrap().contains('Q'));
    }

    #[test]
    fn empty_and_unknown_are_not_silently_compliant() {
        assert!(!classify(&[]).0);
        assert!(!classify(&[profile("Q", "unknown")]).0);
    }

    #[test]
    fn normalized_guids_match() {
        assert_eq!(normalize_key("{ABC-123}"), normalize_key("abc123"));
    }

    /// Regression for the reported field issue: Windows names the VirtualBox
    /// host-only adapter "以太网 2" (Ethernet 2), and NLM reports it as unknown.
    /// It must not be treated as the LAN carrier nor block a private Wi-Fi.
    #[test]
    fn virtualbox_host_only_does_not_block_private_wifi() {
        let wifi = wifi();
        let host_only = virtualbox_host_only();
        let interfaces = vec![wifi.clone(), host_only.clone()];
        let profiles = profiles_for(&[
            (&wifi, "Q", "private"),
            (&host_only, "以太网 2", "unknown"),
        ]);

        let status = evaluate(&interfaces, &profiles);
        assert!(status.compliant, "private Wi-Fi must stay usable: {:?}", status.error);
        assert_eq!(status.networks.len(), 1, "only the real Wi-Fi may be listed");
        assert_eq!(status.networks[0].name, "Q");
        assert_eq!(status.networks[0].category, "private");
    }

    #[test]
    fn only_virtualbox_host_only_is_blocked_without_fallback() {
        let host_only = virtualbox_host_only();
        let interfaces = vec![host_only.clone()];
        let profiles = profiles_for(&[(&host_only, "以太网 2", "unknown")]);

        let status = evaluate(&interfaces, &profiles);
        assert!(!status.compliant);
        assert!(status.checked);
        assert!(status.networks.is_empty(), "virtual adapters must never be selected");
        assert!(
            status.error.unwrap_or_default().contains("虚拟网卡"),
            "the reason must name the virtual adapter"
        );
    }

    #[test]
    fn public_virtualbox_does_not_block_private_wifi() {
        let wifi = wifi();
        let host_only = virtualbox_host_only();
        let interfaces = vec![host_only.clone(), wifi.clone()];
        let profiles = profiles_for(&[
            (&host_only, "以太网 2", "public"),
            (&wifi, "Q", "private"),
        ]);

        let status = evaluate(&interfaces, &profiles);
        assert!(status.compliant, "a virtual Public adapter must not block real Private Wi-Fi");
        assert_eq!(status.networks.len(), 1);
        assert_eq!(status.networks[0].category, "private");
    }

    #[test]
    fn public_physical_wifi_blocks_even_with_private_virtual_adapter() {
        let wifi = wifi();
        let host_only = virtualbox_host_only();
        let interfaces = vec![wifi.clone(), host_only.clone()];
        let profiles = profiles_for(&[
            (&wifi, "Q", "public"),
            (&host_only, "以太网 2", "private"),
        ]);

        let status = evaluate(&interfaces, &profiles);
        assert!(!status.compliant, "real Public Wi-Fi must still block");
        assert_eq!(status.networks.len(), 1);
        assert_eq!(status.networks[0].category, "public");
    }

    #[test]
    fn public_virtual_adapter_does_not_block_private_wifi() {
        let interfaces = vec![
            crate::discovery::Ipv4Interface {
                ip: Ipv4Addr::new(192, 168, 2, 43),
                prefix_len: 24,
                adapter_name: "{A}".to_string(),
                friendly_name: "Wi-Fi".to_string(),
                adapter_description: "Intel(R) Wi-Fi 6 AX201 160MHz".to_string(),
                mac: Some([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]),
                if_type: 71,
                oper_status: 1,
            },
            crate::discovery::Ipv4Interface {
                ip: Ipv4Addr::new(172, 20, 0, 1),
                prefix_len: 16,
                adapter_name: "{B}".to_string(),
                friendly_name: "vEthernet (Default Switch)".to_string(),
                adapter_description: "Hyper-V Virtual Ethernet Adapter".to_string(),
                mac: Some([0x00, 0x15, 0x5d, 0x00, 0x00, 0x01]),
                if_type: 6,
                oper_status: 1,
            },
        ];
        let profiles = HashMap::from([
            ("a".to_string(), profile("Q", "private")),
            ("b".to_string(), profile("Hyper-V", "public")),
        ]);
        let status = evaluate(&interfaces, &profiles);
        assert!(status.compliant);
        assert_eq!(status.networks.len(), 1);
        assert_eq!(status.networks[0].name, "Q");
    }

    /// A localized friendly name alone must never decide the outcome: the
    /// description identifies the driver, and a plain physical adapter with a
    /// localized name is still usable.
    #[test]
    fn localized_friendly_name_does_not_affect_detection() {
        // Virtual driver behind a neutral name -> skipped.
        let hyper_v = adapter(
            [172, 20, 0, 1],
            "以太网 3",
            "Hyper-V Virtual Ethernet Adapter",
            6,
            Some([0x00, 0x15, 0x5d, 0x00, 0x00, 0x02]),
        );
        // Real driver behind a localized name -> kept.
        let real = ethernet();
        let interfaces = vec![hyper_v.clone(), real.clone()];
        let profiles = profiles_for(&[(&hyper_v, "vEthernet", "public"), (&real, "网络 2", "private")]);

        let status = evaluate(&interfaces, &profiles);
        assert!(status.compliant, "the real adapter must carry the decision");
        assert_eq!(status.networks.len(), 1);
        assert_eq!(status.networks[0].name, "网络 2");
    }

    #[test]
    fn other_virtual_drivers_are_filtered_out() {
        let cases = [
            ("VMware Network Adapter VMnet8", "VMware Virtual Ethernet Adapter for VMnet8"),
            ("Ethernet 4", "TAP-Windows Adapter V9"),
            ("以太网 5", "WireGuard Tunnel"),
            ("vEthernet (WSL)", "Hyper-V Virtual Ethernet Adapter #2"),
            ("Tailscale", "Tailscale Tunnel"),
            ("ZeroTier One [x]", "ZeroTier One Virtual Port"),
        ];
        for (friendly, description) in cases {
            let virtual_adapter = adapter([10, 8, 0, 2], friendly, description, 6, None);
            assert!(
                is_virtual_adapter(&virtual_adapter),
                "{friendly} / {description} must be recognised as virtual"
            );
        }
    }

    #[test]
    fn plain_physical_adapters_are_kept() {
        for interface in [wifi(), ethernet()] {
            assert!(
                !is_virtual_adapter(&interface),
                "{} must be treated as physical",
                interface.adapter_description
            );
        }
        let status = evaluate(
            &[wifi(), ethernet()],
            &profiles_for(&[( &wifi(), "Q", "private"), (&ethernet(), "网络 2", "domain")]),
        );
        assert!(status.compliant);
        assert_eq!(status.networks.len(), 2);
    }

    #[test]
    fn virtual_adapter_recognised_by_mac_even_with_neutral_names() {
        let neutral = adapter(
            [10, 0, 0, 5],
            "Ethernet 9",
            "",
            6,
            Some([0x00, 0x50, 0x56, 0x00, 0x00, 0x01]),
        );
        assert!(is_virtual_adapter(&neutral));
        let status = evaluate(&[neutral.clone()], &profiles_for(&[(&neutral, "VM", "private")]));
        assert!(!status.compliant, "a VM adapter alone must not enable the LAN service");
    }

    /// Manual diagnostics: prints what the current machine really reports so a
    /// field issue can be reproduced without the desktop UI. Run with
    /// `cargo test -- --ignored --nocapture diagnose_local_machine_adapters`.
    #[test]
    #[ignore = "manual: inspects the local machine's real adapters"]
    fn diagnose_local_machine_adapters() {
        let interfaces = crate::discovery::ipv4_interfaces().expect("enumerate interfaces");
        for interface in &interfaces {
            println!(
                "iface ip={} ifType={} oper={} friendly={:?} description={:?} mac={:?} virtual={}",
                interface.ip,
                interface.if_type,
                interface.oper_status,
                interface.friendly_name,
                interface.adapter_description,
                interface.mac,
                is_virtual_adapter(interface)
            );
        }
        let profiles = read_network_connections().expect("read network profiles");
        for (key, profile) in &profiles {
            println!("profile key={key} name={:?} category={}", profile.name, profile.category);
        }
        let status = evaluate(&interfaces, &profiles);
        println!(
            "status checked={} compliant={} networks={:?} error={:?}",
            status.checked, status.compliant, status.networks, status.error
        );
    }
}
