# Filebridge-Lan 1.6.1

发布日期：2026-11-15

这是 **1.6.1 稳定版**，基于通过验收的 `1.6.1-preview.1` 代码创建，仅做版本与发布文档变更。它修复了 1.6.0 的发布阻断缺陷：二维码与分享链接错误地选择了 VirtualBox Host-Only 等虚拟网卡地址。

## 本版本修复

### 二维码 / 分享链接选错网卡

现场：Windows 同时存在真实 WLAN（192.168.2.53，Private）与 VirtualBox Host-Only（`以太网 4`，192.168.56.1，Up）时，Hub 公布的地址把虚拟网卡排在前面：

```json
{ "ips": ["192.168.56.1", "192.168.2.53"] }
```

前端直接取第一项，二维码变成 `http://192.168.56.1:42080`，手机无法连接。1.6.0 因此废弃，未发布。

### 修复内容

- **Rust Hub 只公布真实可用局域网接口**：`local_ips` 改为使用与网络合规判定同一套真实/虚拟网卡识别（驱动描述 + 已知虚拟厂商 MAC 前缀 + 名称标记），不再使用未过滤的接口枚举；`/api/info.ips` 与界面链接、二维码共用同一个结果。
- **地址优先级**：当前默认路由网卡优先（`GetBestInterface`，只查路由表不发包）→ Windows `InterfaceMetric` → 地址本身；不再按 `192.168/10/172` 前缀排序。
- **各种网络形态**：
  - 物理 Wi-Fi 与 Ethernet 同时在线时，选默认路由网卡；
  - Wi-Fi 断开、Ethernet 在线时选 Ethernet；Ethernet 断开、Wi-Fi 在线时选 Wi-Fi；
  - 无互联网但仍存在真实局域网时，退化为按 `InterfaceMetric` 排序的真实网卡；
  - VirtualBox Host-Only / TAP-Windows / Hyper-V / VMware / VPN / WSL / Docker / Wi-Fi Direct / 6to4·ISATAP·Teredo 永不进入候选；只有虚拟网卡时候选为空，不生成任何二维码链接。
- **Node Hub 与 Rust Hub 一致**：新增 `server/lan-ips.mjs`，使用同一过滤与排序策略；默认路由通过 UDP `connect()` 读取本机出口地址（不发包）。两边用同一份共享夹具 `scripts/fixtures/lan-ips.json` 断言相同候选顺序。
- **发现广播**：定向广播目标只基于真实局域网接口，不再向 VirtualBox Host-Only 等虚拟子网发送。
- **前端兜底**：`pickPhoneHost()` 只接受 Hub 提供的私网候选，跳过回环/链路本地/多播/非法地址；若候选里出现 VirtualBox 默认网段 `192.168.56.0/24`，优先使用其它地址，因此即使旧版 Hub 顺序错误也不会生成错误二维码；候选多于一个时，界面在二维码下方列出「其它可用地址」。

## 1.6.0 已具备、本版本继续提供的能力

- **文字剪贴板同步**：已批准连接内双向同步纯文本，默认开启、可随时关闭，只存内存；来源由服务端推导，客户端无法伪造；断线/token 失效/关闭同步时清空。
- **Safari Fetch 分块上传与真实 offset 断点续传**：以服务端确认 offset 为准，刷新或断线后可继续。
- **SHA-256 完整性与 `.part` 原子转换**：边写边算哈希，完成后校验并原子重命名。
- **远端断线提示与 SSE heartbeat**：区分「在线但无传输」与「连接已断开」。
- **电脑互联**：附近电脑发现（UDP 42081）、主机显式批准后签发 token。
- **Public 网络门禁**：真实物理网卡为 Public 时暂停 Hub 与发现服务，切回专用网络自动恢复；只有虚拟网卡或没有真实网络时保持阻断并说明原因。
- **单实例与端口占用恢复**；**安装器内置防火墙配置**（规则就绪时静默）。
- **新 Logo、favicon、Tauri 与 NSIS 图标**。

## 实机验证

在安装了 VirtualBox 的真实机器上（`以太网 4` = VirtualBox Host-Only 192.168.56.1，保持 Up；`以太网 2` 为另一块 Host-Only；`以太网 3` 为 TAP；物理 WLAN 192.168.2.53 Private）：

```
/api/info.ips = ["192.168.2.53"]
二维码地址     = http://192.168.2.53:42080
```

`192.168.56.1` 不再出现，手机可扫码连接。用户在 `1.6.1-preview.1` 的 CI 资产上完成了该项验收。

## 安全边界

- **局域网连接使用 HTTP 明文**，配对码与 token 只是访问控制，不是内容加密；只应在可信的专用网络中运行。
- 不要把 42080 暴露到公网；防火墙规则仅放行 Domain/Private。
- **跨网络中继仍是实验性功能**：只保存 AES-GCM 密文，需要自建 HTTPS Relay，未完成真实 WAN 生产验证。
- 安装包**未做代码签名**，Windows SmartScreen 可能提示「未知发布者」；请以 Release 正文中的 SHA-256 校验安装包。

## 支持范围

- Windows 10 21H2 及以上 / Windows 11，x64。
- 手机端：iOS Safari 17+、Android Chrome；桌面端：Microsoft Edge / Chrome。
- 承诺场景为同一专用网络内的单子网互传；多网卡/VPN/AP 隔离/跨子网未纳入承诺范围。
- 不提供 ARM64 与 32 位构建。

## 自动化测试结果

| 命令 | 结果 |
|---|---|
| `npm run check` | 通过 |
| `npm run build` | 通过 |
| `npm run test:version` | `VERSION_OK 1.6.1` |
| `npm run test:connection` | 通过 |
| `npm run test:clipboard` | 通过 |
| `npm run test:lan` | 14 项通过（网卡过滤、地址优先级、二维码 IP、共享夹具） |
| `npm run test:hub` | `HUB_SMOKE_OK` |
| `npm run test:resume` | `RESUME_SMOKE_OK` |
| `npm run test:offsets` | 通过 |
| `npm run test:bridge` | `BRIDGE_SMOKE_OK` |
| `npm run test:firewall` | `FIREWALL_INSTALLER_TEST_OK` |
| `cargo test` | 通过（含虚拟网卡过滤、地址排序、发现广播目标） |
| `cargo check` | 通过 |
| `git diff --check` | 干净 |

## 版本与发布状态

- `v1.6.0` tag 与 Draft 保留，Draft 标记「已废弃，请勿发布」，未发布。
- `v1.6.0-preview.1`–`preview.5` 的 tag、Release/Draft 与资产均未改动。
- 本版本为稳定版，`v1.6.1` 为 GitHub Latest。

## 安装与升级

- 从 GitHub Releases 下载 `Filebridge-Lan_1.6.1_x64-setup.exe`，SHA-256 见 Release 正文。
- 默认按当前用户安装到 `%LOCALAPPDATA%\Filebridge-Lan`；从 1.5.x / 1.6.x Preview 升级会保留下载目录与数据。
