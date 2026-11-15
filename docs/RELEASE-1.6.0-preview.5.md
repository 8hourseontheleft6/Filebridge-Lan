# Filebridge-Lan 1.6.0 Preview 5

发布日期：2026-11-15（Draft，未发布）

这是一个 **Preview 候选**，用于验收。它修复虚拟网卡误判导致真实专用网络被错误阻断的问题；真实手机、真实双机与跨网络环境仍未按本构建验收。

## 本轮实际完成

### 虚拟网卡误判（现场问题）

现场：Windows 上装有 VirtualBox，Host-Only 网卡被系统命名为「以太网 2」，NetworkListManager 不返回它的网络类型（显示为未知网络）。旧逻辑只按适配器显示名判断虚拟网卡，而「以太网 2」不含 virtualbox/vbox，于是这块虚拟网卡被当成真实网络，与 Private 的 WLAN 一起判定，最终整个局域网服务被阻断。

修复：

- **识别来源改为驱动描述**：`Ipv4Interface` 新增 `adapter_description`（`GetAdaptersAddresses::Description`）与 `mac` 字段。虚拟网卡判断同时检查显示名、驱动描述和已知虚拟厂商的 MAC 前缀，不再依赖「以太网 2」这类本地化自动命名。
- **覆盖的虚拟适配器**：VirtualBox（Host-Only / NAT）、Hyper-V / vEthernet、VMware（VMnet / Virtual Ethernet）、TAP-Windows / OpenVPN、WireGuard、Tailscale、ZeroTier、WSL、Docker、Microsoft Wi-Fi Direct、6to4 / ISATAP / Teredo、包含 VPN/Tunnel 标记的隧道网卡。
- **移除「找不到物理网卡就回退到全部 private 接口」的回退**：已知虚拟网卡不会被重新放回候选集合。只有虚拟网卡或没有已连接的真实网络时，服务保持阻断。
- **只判断真实承载网络的物理接口**：虚拟 Public 不会阻断真实 Private WLAN；真实物理 Wi-Fi 为 Public 时仍必须阻断。
- **阻断原因可读**：新增 `no_usable_network` 网关状态，界面文案从「当前网络为公用网络」改为「没有可用的真实网络」，并说明虚拟网卡不承载局域网服务。

### 新增回归测试

`src-tauri/src/network_profile.rs`：

1. `virtualbox_host_only_does_not_block_private_wifi`：现场复现（以太网 2 / VirtualBox Host-Only / ifType 6 / 192.168.56.1 + Private WLAN）→ `compliant = true`，`networks` 只包含 WLAN。
2. `only_virtualbox_host_only_is_blocked_without_fallback`：只有 Host-Only → `compliant = false`，`networks` 为空，错误信息说明只检测到虚拟网卡。
3. `public_virtualbox_does_not_block_private_wifi`：虚拟网卡为 Public、WLAN 为 Private → 仍放行。
4. `public_physical_wifi_blocks_even_with_private_virtual_adapter`：真实 Wi-Fi 为 Public、虚拟网卡为 Private → 仍阻断。
5. `localized_friendly_name_does_not_affect_detection`：本地化显示名不影响判断，真实网卡决定结果。
6. `other_virtual_drivers_are_filtered_out` / `plain_physical_adapters_are_kept`：Hyper-V、VMware、TAP、WireGuard、Tailscale、ZeroTier、WSL 被过滤，普通 Wi-Fi / 以太网保留。
7. `virtual_adapter_recognised_by_mac_even_with_neutral_names`：显示名与描述都中性时，靠 MAC 前缀识别 VM 网卡。

`src-tauri/src/lan_service.rs` 另加 `gate_names_public_network_and_missing_network_differently`，锁定 Public 与「没有可用网络」两种网关状态不会混淆。

### 现场诊断测试

新增 `#[ignore]` 测试 `diagnose_local_machine_adapters`，输出本机真实枚举到的每个网卡的 IP / ifType / operStatus / 显示名 / 驱动描述 / MAC / 是否判定为虚拟，以及最终状态。在受影响机器上运行：

```
cargo test -- --ignored --nocapture diagnose_local_machine_adapters
```

## 界面变更

- 网络阻断弹窗新增「没有可用的真实网络」版本，说明只检测到虚拟网卡，并给出「连接真实 Wi-Fi 或以太网」的建议，而不是此前不适用的「把网络改为专用网络」。
- 局域网暂停卡片同样区分这两种原因。

截图：`docs/screenshots/network-virtual-only-1440.png`、`docs/screenshots/network-virtual-only-390.png`（由当前构建渲染）。

## 协议与安全

- 本次不改动 `/api/clipboard*`、上传与配对协议。
- 安全原则不变：真实物理 WLAN/Ethernet 为 Public 时仍阻断；虚拟网卡不参与判定；没有真实网络时不启动 Hub 和发现服务。
- 不修改防火墙规则、Defender 设置或 VirtualBox 全局配置。

## 自动化测试结果（本构建实际运行）

| 命令 | 结果 |
|---|---|
| `cargo test` | 35 通过 / 2 忽略 |
| `cargo check` | 通过（1 条既有弃用警告） |
| `npm run check` | 通过 |
| `npm run build` | 通过 |
| `npm run test:connection` | 通过 |
| `npm run test:clipboard` | 通过 |
| `npm run test:hub` | `HUB_SMOKE_OK` |
| `npm run test:offsets` | 通过 |
| `npm run test:version` | `VERSION_OK 1.6.0-preview.5` |
| `git diff --check` | 干净 |

本机（含 VirtualBox Host-Only 适配器与 TAP-Windows 适配器）实际枚举结果：WLAN 判定为真实网卡，TAP-Windows Adapter V9 判定为虚拟并被过滤，最终状态 `compliant = true`、网络列表只含 Private 的 WLAN。

## 仍需用户验收（未完成，不要当作已验证）

- 在「以太网 2（VirtualBox Host-Only）为 Up」的真实现场确认应用不再阻断：需要用户自己的环境（本次没有启用用户的 VirtualBox 网卡，也没有修改其配置）。
- 真实手机（iPhone Safari / Android Chrome）与本构建的完整交互。
- 真实双机传输与 Public 网络切换。
- 多网卡 / VPN / AP 隔离环境。
- 安装包未签名，SmartScreen 可能提示。

## 安装

- 安装包由 CI 从 tag 构建，文件名 `Filebridge-Lan_1.6.0-preview.5_x64-setup.exe`，SHA-256 见 Release 正文。
- 本构建为 Draft，未公开发布。
