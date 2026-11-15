# Filebridge-Lan 1.6.0

发布日期：2026-11-15

这是 **1.6.0 稳定版**，也是 1.5.6 之后的第一个稳定版本。它把 1.6.0-preview.1–preview.5 验证过的内容收敛为正式版，并在发布前完成了本地自动化回归与用户真实环境验收。

## 本版本重点

### 文字剪贴板同步

- 在已批准并持有有效 token 的连接内双向同步纯文本：桌面上复制 → 手机看到；手机发送 → 写入桌面系统剪贴板。
- 默认开启、可随时关闭；只有主机本机（loopback）可以切换开关，远端调用返回 `403 clipboard_host_only`。
- 单条上限 262144 字节（UTF-8），写入限流 30 次/分钟（全局）与 10 次/分钟（单 IP），超出分别返回 `413` / `429`。
- 文本只存在于 Hub 内存：不落盘、不进入发现广播、URL、普通日志、SSE 文件事件或上传诊断。
- 来源由服务端按连接推导（loopback → desktop，其余 → phone），客户端无法伪造 `source` 抑制主机写剪贴板。
- 断线、token 失效、关闭同步或 Public 暂停时，两端的上一连接文本会立即清空。
- 浏览器不允许后台静默复制：手机端始终保留收到的文本并提供「复制」，权限被拒时可手动选择复制。

### 传输界面与安装体验

- 上传与下载拆成两张等高速率卡（当前速率、峰值、累计、底部速率折线），批量上传只显示「第 X/Y 个」。
- 文件列表固定高度、行不再挤压；头部动作改为圆形图标；删除文件与进度块带退场动画。
- 文件可拖到窗口任意位置上传，拖放提示有编排进出场动画，并在 `prefers-reduced-motion` 下保留静态提示。
- 上传完成后进度块保留约 1.6 秒再收起；取消后可用圆形刷新按钮重新上传。
- 配对详情默认折叠；使用说明改为 6 步上手流程。
- 侧栏分为「传输方式 / 应用」：局域网直传是主入口，跨网络中继为次要的实验入口（浏览器端与窄屏不显示）。
- 安装器内置 Windows 防火墙配置：规则已指向安装目录 exe 时重装/升级完全静默；仅在规则缺失或失效时请求一次管理员授权并以隐藏窗口执行，不再弹出 PowerShell 窗口。

### 虚拟网卡不再被误判

- 网络判定只考虑真实物理网卡；识别依据为驱动描述（`GetAdaptersAddresses::Description`）与已知虚拟厂商 MAC 前缀，不依赖本地化显示名。
- VirtualBox（Host-Only / NAT）、Hyper-V / vEthernet、VMware、TAP-Windows / OpenVPN、WireGuard、Tailscale、ZeroTier、WSL、Docker、Wi-Fi Direct 等不再被视为局域网承载网络。
- 修复了 Windows 把 VirtualBox Host-Only 显示为「以太网 2」且不给它网络类型，进而把真实 Private WLAN 误判为不合规、阻断整个服务的问题。
- 只有虚拟网卡或没有已连接的真实网络时，服务保持阻断，并提示「没有可用的真实网络」。

## 1.5.x 已具备、本版本继续提供的能力

- **Safari Fetch 分块上传与真实 offset 断点续传**：iPhone Safari 分块上传，服务端确认的 offset 为准；刷新或断线后可继续传输。
- **SHA-256 完整性与 `.part` 原子转换**：上传边写边算哈希，完成后校验并通过原子重命名转正，不会产生「看起来成功但内容损坏」的文件。
- **远端断线提示与 SSE heartbeat**：`/api/events` 每 5 秒发送 heartbeat，客户端据此区分「连接在线但无传输」和「连接已断开」。
- **Public 网络暂停与恢复**：真实物理网卡为 Public 时暂停局域网 Hub 与发现服务，切回专用网络后自动恢复。
- **单实例与端口占用恢复**：Windows 单实例保护；TCP 42080 / UDP 42081 被占用时报告真实原因并在释放后自动重试。
- **附近电脑发现与主机显式批准**：同一局域网通过 UDP 42081 发现电脑，连接请求必须由主机在桌面端显式批准后才签发 token。
- **新 Logo、favicon、Tauri 与 NSIS 图标**：统一的品牌标记与白色底应用图标。

## 安全边界

- **局域网连接使用 HTTP 明文**，配对码与 token 只是访问控制，不是内容加密；只应在可信的专用网络中运行。
- 不要将 42080 暴露到公网；防火墙规则仅放行 Domain/Private。
- **跨网络中继仍是实验性功能**：只保存 AES-GCM 密文，需要自建 HTTPS Relay；未完成真实 WAN 生产验证，不能当作稳定能力依赖。
- 安装包**未做代码签名**，Windows SmartScreen 可能提示「未知发布者」；请以 Release 正文中的 SHA-256 校验安装包。

## 支持范围

- Windows 10 21H2 及以上 / Windows 11，x64。
- 手机端：iOS Safari 17+、Android Chrome；桌面端：Microsoft Edge / Chrome。
- 承诺场景为同一专用网络内的单子网互传；多网卡 / VPN / AP 隔离 / 跨子网环境未纳入承诺范围。
- 不提供 ARM64 与 32 位构建。

## 验收记录

- 用户在 `v1.6.0-preview.5` 的 CI 构建资产上完成了约定验收并通过，覆盖真实手机、真实双机传输、Public/Private 网络切换，以及安装 VirtualBox 的现场环境（含「以太网 2」为 VirtualBox Host-Only 的误判场景）。
- 稳定版基于该已验收的代码创建，仅做版本与发布文档变更，未引入新的功能代码。

## 自动化测试结果

| 命令 | 结果 |
|---|---|
| `npm run check` | 通过 |
| `npm run build` | 通过 |
| `npm run test:version` | `VERSION_OK 1.6.0` |
| `npm run test:connection` | 通过 |
| `npm run test:clipboard` | 通过 |
| `npm run test:hub` | `HUB_SMOKE_OK` |
| `npm run test:resume` | `RESUME_SMOKE_OK` |
| `npm run test:offsets` | 通过 |
| `npm run test:bridge` | `BRIDGE_SMOKE_OK` |
| `npm run test:firewall` | `FIREWALL_INSTALLER_TEST_OK` |
| `cargo test` | 通过 |
| `cargo check` | 通过 |
| `git diff --check` | 干净 |

## 安装与升级

- 从 GitHub Releases 下载 `Filebridge-Lan_1.6.0_x64-setup.exe`，SHA-256 见 Release 正文。
- 默认按当前用户安装到 `%LOCALAPPDATA%\Filebridge-Lan`；从 1.5.x / 1.6.0-preview 升级会保留下载目录与数据。
- 首次安装或防火墙规则失效时需要一次管理员授权；规则已就绪时重装/升级完全静默。

## 已知限制

- 安装包未签名，SmartScreen 可能提示。
- 跨网络中继为实验性功能，真实 WAN 未做生产承诺。
- 移动浏览器不允许后台静默复制，复制需用户点击。
- 只能在同一个专用网络内直传；跨子网、AP 隔离等环境不支持。
