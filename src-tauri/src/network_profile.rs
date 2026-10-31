use std::collections::{HashMap, HashSet};

use serde::Serialize;

#[derive(Clone, Serialize)]
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

fn classify(networks: &[NetworkProfile]) -> (bool, Option<String>) {
    if networks.is_empty() {
        return (false, Some("未检测到已连接的网络".to_string()));
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

fn is_virtual_adapter(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    [
        "vethernet",
        "hyper-v",
        "vmware",
        "virtualbox",
        "vbox",
        "tap",
        "tun",
        "wireguard",
        "tailscale",
        "zerotier",
        "wsl",
        "vpn",
        "loopback",
        "bluetooth",
    ]
    .iter()
    .any(|marker| name.contains(marker))
}

fn is_physical_if_type(if_type: u32) -> bool {
    // IF_TYPE_ETHERNET_CSMACD = 6, IF_TYPE_IEEE80211 = 71
    matches!(if_type, 6 | 71)
}

fn effective_networks(
    interfaces: &[crate::discovery::Ipv4Interface],
    profiles: &HashMap<String, NetworkProfile>,
) -> Result<Vec<NetworkProfile>, String> {
    let mut eligible: Vec<&crate::discovery::Ipv4Interface> = interfaces
        .iter()
        .filter(|interface| {
            interface.oper_status == 1
                && is_private_ipv4(interface.ip)
                && interface.if_type != 24
                && interface.if_type != 131
                && !is_virtual_adapter(&interface.friendly_name)
        })
        .collect();

    // If a machine exposes an unusual physical interface type, fall back to
    // all up/private interfaces rather than permanently blocking FileBridge.
    if eligible.is_empty() {
        eligible = interfaces
            .iter()
            .filter(|interface| {
                interface.oper_status == 1
                    && is_private_ipv4(interface.ip)
                    && interface.if_type != 24
                    && interface.if_type != 131
            })
            .collect();
    }

    // Prefer physical Ethernet/Wi-Fi interfaces when available. This keeps a
    // virtual Public adapter from blocking a real Private Wi-Fi network.
    let physical: Vec<&crate::discovery::Ipv4Interface> = eligible
        .iter()
        .copied()
        .filter(|interface| is_physical_if_type(interface.if_type))
        .collect();
    if !physical.is_empty() {
        eligible = physical;
    }

    if eligible.is_empty() {
        return Err("未找到可用于 Filebridge-Lan 的专用 IPv4 接口".to_string());
    }

    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for interface in eligible {
        let key = normalize_key(&interface.adapter_name);
        let profile = profiles.get(&key).cloned().unwrap_or_else(|| NetworkProfile {
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
    Ok(result)
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

fn read_profiles() -> Result<Vec<NetworkProfile>, String> {
    let profiles = read_network_connections()?;
    let interfaces = crate::discovery::ipv4_interfaces()?;
    effective_networks(&interfaces, &profiles)
}

#[tauri::command]
pub fn network_profile_status() -> NetworkProfileStatus {
    // NetworkListManager is COM-based. Run it on a fresh thread so the
    // WebView2/UI thread's COM apartment mode cannot interfere.
    let result = std::thread::spawn(read_profiles)
        .join()
        .map_err(|_| "网络类型检测线程异常退出".to_string());
    match result {
        Ok(Ok(networks)) => {
            let (compliant, error) = classify(&networks);
            NetworkProfileStatus {
                checked: true,
                compliant,
                networks,
                error,
            }
        }
        Ok(Err(error)) => NetworkProfileStatus {
            checked: false,
            compliant: false,
            networks: Vec::new(),
            error: Some(error),
        },
        Err(error) => NetworkProfileStatus {
            checked: false,
            compliant: false,
            networks: Vec::new(),
            error: Some(error),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(name: &str, category: &str) -> NetworkProfile {
        NetworkProfile {
            name: name.to_string(),
            category: category.to_string(),
            label: category.to_string(),
        }
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
        assert_eq!(
            normalize_key("{ABC-123}"),
            normalize_key("abc123")
        );
    }
}
