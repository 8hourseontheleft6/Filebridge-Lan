# Filebridge-Lan 1.5.3

发布日期：2026-10-31（已正式发布）

1.5.3 是 1.5.2 的发布后修复版本，保持现有局域网发现、主机确认、传输主流程和已验收的防火墙脚本不变，修复 Public 网络下的状态文案与交互。

1.5.0 聚焦电脑端互联：自动发现 + 主机确认，同时保留扫码、手动配对码和直接 IP 访问。

## 正式 Release

- Release URL：https://github.com/8hourseontheleft6/Filebridge-Lan/releases/tag/v1.5.3
- tag：`v1.5.3`
- tag commit：`d87c159675c051d6bd53a0767545d8d63bfa4d94`
- 资产名称：`Filebridge-Lan_1.5.3_x64-setup.exe`
- 大小：`5,364,457 bytes`
- SHA-256：`83dda9d735cd0a969c3781908e2f6aac9e1bdf83e50c534154ba3b983c67ea72`
- 状态：正式发布，`isDraft=false`，`prerelease=false`，当前 Latest

## 两条连接路径

### A. 两台电脑都安装客户端

- Rust 内置 UDP 42081 局域网发现
- 首页“附近电脑”显示设备名、IP、端口和版本
- 点击“连接”后自动发起连接请求
- 主机客户端弹出确认框，显示设备名、来源 IP 和有效期
- 启动时检测 Windows 网络配置文件
- **Public/未知网络：不启动 UDP 发现，不在局域网接口启动 HTTP Hub**
- Private/Domain 才启动局域网服务；切回 Private 后自动恢复
- 公用网络会弹窗提示改为专用网络，关闭弹窗不能绕过服务门禁
- 允许后自动进入传输界面

### B. 另一台电脑不安装客户端

- 浏览器打开主机的局域网地址
- 页面打开后自动进入“等待主机确认”，调用连接请求 API
- 主机客户端在任何传输模式下都会弹出确认框
- 主机确认后自动获得 12 小时 token 并进入文件页
- 60 秒内未确认显示“主机未确认或请求已过期”，允许重试
- 不需要输入配对码
- 扫码和手动配对码仍作为回退

## 连接协议

- `POST /api/connect/requests` 创建请求
- `GET /api/connect/requests` 主机本机读取待确认请求
- `GET /api/connect/requests/:id` 发起方用 `X-Connect-Secret` 查询状态
- `POST /api/connect/requests/:id/decision` 主机本机批准/拒绝
- request id 和 secret 使用 128-bit 以上随机值
- 默认 60 秒过期，只能批准一次
- 按 IP + 全局限流，pending 上限 8
- 批准后才签发 token；拒绝、过期、重复批准不返回 token

## 1.5.3 修复

- Public 网络下显示独立安全暂停状态：
  - “当前网络为公用网络，局域网传输服务已暂停。”
  - “切换到专用网络后将自动恢复，不会在 Public 网络开放 42080/42081。”
- Public 下不再渲染局域网 IP、扫码、手动配对或“重试连接”
- Public 下提供“前往网络设置”
- “已配对”补充“当前不可连接/在线/服务异常”
- 区分 Public 安全暂停、局域网服务异常、无法连接电脑端服务
- Private 恢复后自动重新探测 Hub
- 不改动 1.5.2 已验证的防火墙脚本和安全策略

## 1.5.2 修复

- 修复安装器防火墙规则：不再使用超长 `-Command`
- 安装器释放 `install-firewall.ps1`，用 `-File` 和 `-ExePath` 调用
- 严格创建 TCP 42080、UDP 42081，Domain/Private，Inbound Allow
- 创建后立即校验协议、端口、Profile、方向、动作和程序路径
- 安装器测试覆盖含空格和 `$` 的脚本/程序路径，并禁止 `LocalPort 4`、`Profile Any`

## 1.5.1 修复

- 网络从 Public 切回 Private、Hub 重启后自动通过 loopback 会话码重新配对，不再停在“授权已过期”
- 设置页改为工作区页面；关于区默认仅显示应用名和版本
- 修复 GitHub 链接无响应；隐藏滚动条；说明改为悬浮提示

## 发现协议

- UDP 42081：全局广播 + 每个有效 IPv4 子网的定向广播（例如 `192.168.2.255`）
- 定向目标每 5 秒刷新，适配 Wi-Fi 重连和 IP/前缀变化
- 仅包含 `app`、`version`、稳定实例 ID、设备名、Hub 端口
- 不广播配对码、token、文件名或路径
- 发现失败不阻塞原有局域网直传
- `discovery_status` 提供绑定、发送目标、最后收发时间、当前错误、最近错误和 peer 数量
- Public/未知网络下发现线程和局域网 Hub 都不会启动
- **真实双机发现与传输主流程已由用户验证通过**


## 防火墙

- TCP 42080：Private/Domain
- UDP 42081：Private/Domain
- 程序级规则，无 Public/Any
- v1.5.2 安装器已在真机安装验证；v1.5.3 沿用同一防火墙脚本

## 发布流程（已完成）

- GitHub Release workflow 从 `v1.5.3` tag 构建 NSIS 安装包并创建 Draft。
- Draft 资产经下载、SHA-256 核验和人工安装/双机测试通过。
- `v1.5.3` Draft 已原地发布，没有重新构建。
- 发布过程未重新上传、未替换附件、未移动 tag。

## 已验证

- Private 网络下 TCP 42080 / UDP 42081 防火墙规则正确，Profile 为 Domain/Private，Inbound Allow，指向当前安装的 `filebridge-lan.exe`
- Public 网络下 TCP 42080 和 UDP 42081 均无监听
- 点击 Windows 网络提示的“稍后设置”后，Public 门禁保持关闭
- 切回 Private 后自动恢复监听和配对，不再出现“授权已过期”
- Private 网络下发现、主机批准、文件页和一次实际传输正常
- 安装器防火墙/UAC 在新安装包上的检查通过

## 已知限制

在 Windows 网络类型检测失败、没有可用网络适配器或网络类别未知时，界面可能沿用“公用网络安全暂停”提示。此时安全门禁仍保持关闭，TCP 42080 和 UDP 42081 不会开放。该问题仅影响错误状态文案，不影响 Public 门禁、Private 自动恢复或防火墙规则。计划在后续版本中进一步区分网络检测失败状态。

## 尚未验证

- 多网卡/VPN/AP 隔离/跨子网环境
- 真实手机 390×844 的最终构建复测

