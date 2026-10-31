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
        let names = unsupported.iter().map(|network| network.name.as_str()).collect::<Vec<_>>().join("、");
        return (false, Some(format!("检测到非专用网络：{names}")));
    }
    (true, None)
}

#[cfg(windows)]
fn read_profiles() -> Result<Vec<NetworkProfile>, String> {
    use windows::core::IUnknown;
    use windows::Win32::Networking::NetworkListManager::{
        INetworkListManager, NetworkListManager, NLM_ENUM_NETWORK_CONNECTED,
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

        let enumerator = unsafe { manager.GetNetworks(NLM_ENUM_NETWORK_CONNECTED) }
            .map_err(|error| format!("读取网络列表失败：{error}"))?;

        let mut profiles = Vec::new();
        loop {
            let mut item: Option<windows::Win32::Networking::NetworkListManager::INetwork> = None;
            let mut fetched = 0u32;
            if let Err(error) = unsafe { enumerator.Next(std::slice::from_mut(&mut item), Some(&mut fetched)) } {
                return Err(format!("遍历网络列表失败：{error}"));
            }
            if fetched == 0 {
                break;
            }
            let Some(network) = item else { break };
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
            profiles.push(NetworkProfile {
                name,
                category: category.to_string(),
                label: label.to_string(),
            });
        }
        Ok(profiles)
    })();

    if initialized {
        unsafe { CoUninitialize() };
    }
    result
}

#[cfg(not(windows))]
fn read_profiles() -> Result<Vec<NetworkProfile>, String> {
    Err("网络类型检测仅支持 Windows".to_string())
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
            NetworkProfileStatus { checked: true, compliant, networks, error }
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
}
