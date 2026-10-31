# Filebridge-Lan 1.5.0

发布日期：2026-10-30（WIP，未发布）

1.5.0 聚焦电脑端互联：自动发现 + 主机确认，同时保留扫码、手动配对码和直接 IP 访问。

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
- 安装器与修复脚本已同步，但尚未在本机实际执行

## 发布流程

- `v1.5.0` tag 触发 CI 从该 tag 构建 NSIS 安装包。
- Release 只创建 **Draft**，不会自动正式发布。
- Draft 的资产和 Release notes 中的 SHA-256 都来自本次 CI 构建。
- 用户下载 Draft 资产复核通过后，才在 GitHub 上手动正式发布；正式发布前不重新构建或替换附件。
- 本地 `release/` 目录的已验证包不能替代 CI Draft 资产。

## 未验证 / 待最终人工复核

- Public 硬门禁的真实 Public 网络切换与 UDP 停止观察
- 关闭网络弹窗后 42081 确实不再广播
- 从 Public 切回 Private 后无需重启的恢复流程
- Windows 防火墙/UAC 在新安装包上的最终状态
- 多网卡/VPN/AP 隔离/跨子网环境
- 真实手机 390×844 的最终构建复测

