# Filebridge-Lan 1.5.0

发布日期：2026-10-30（WIP，未发布）

1.5.0 聚焦电脑端互联：自动发现 + 主机确认，同时保留扫码、手动配对码和直接 IP 访问。

## 两条连接路径

### A. 两台电脑都安装客户端

- Rust 内置 UDP 42081 局域网发现
- 首页“附近电脑”显示设备名、IP、端口和版本
- 点击“连接”后自动发起连接请求
- 主机客户端弹出确认框，显示设备名、来源 IP 和有效期
- 允许后自动进入传输界面

### B. 另一台电脑不安装客户端

- 浏览器打开主机的局域网地址
- 页面提供“请求主机允许”
- 主机客户端确认后自动获得 12 小时 token
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

- UDP 42081 广播，仅包含 `app`、`version`、稳定实例 ID、设备名、Hub 端口
- 不广播配对码、token、文件名或路径
- 发现失败不阻塞原有局域网直传

## 防火墙

- TCP 42080：Private/Domain
- UDP 42081：Private/Domain
- 程序级规则，无 Public/Any
- 安装器与修复脚本已同步，但尚未在本机实际执行

## 未验证

- 真实两台 Windows 电脑的 UDP 广播发现
- Windows 防火墙/UAC 实际放行
- 真实手机 390×844 的等待确认和主机确认
- 多网卡/AP 隔离/跨子网环境
