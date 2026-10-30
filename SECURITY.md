# Security Policy

## 支持范围

当前维护版本：**1.4.x**。

## 报告安全问题

请不要在公开 Issue 中披露可被利用的细节。优先使用 GitHub Security Advisories 私下报告；如果仓库尚未启用，请先联系维护者。

报告时请包含：

- 影响的版本/提交
- 复现步骤或最小 PoC
- 影响范围（读取文件/写入路径/拒绝服务等）
- 是否已在局域网外暴露

## 安全模型

Filebridge-Lan 的目标是**可信局域网**内的个人文件传输：

- HTTP Hub 默认绑定 `0.0.0.0:42080`
- 6 位配对码只用于换取 bearer token；文件 API 不接受配对码
- 配对成功后签发 256-bit 随机 token，12 小时过期；Hub 重启/轮换会清空
- `/api/session` 只允许 loopback + 本机 Origin；Host/Origin 有白名单，拒绝 null Origin、任意域名和 DNS rebinding
- CORS 不使用 `*`；只回显允许的 Origin
- 数据在局域网内明文传输，没有 TLS；token 是访问控制，不是加密
- 二维码包含电脑局域网 IP、配对码；不要把二维码发到不可信的地方
- 配对失败同时按 IP/全局限流
- 跨网络中继对文件内容做 AES-GCM 端到端加密；下载还需要独立 downloadToken
- 公网中继必须设置 `BRIDGE_ACCESS_TOKEN`；非 loopback 必须 HTTPS；未完成真实 WAN 验证
- 中继可见文件名/大小/时间/IP 等元数据
- 中继校验每片预期密文大小、最终文件大小和 SHA-256；hash 只在链接 fragment
- 可信代理模式按 XFF 右侧可信链解析客户端 IP；存储配额创建时原子预留
- 中继 CORS 当前仍允许 `*`，但没有 cookie；访问依赖 bearer access token
- 安装包未做代码签名

因此：

- **不要**把 42080 暴露到公网
- **不要**在不可信 WiFi/办公网络中假设传输是私密的
- 需要跨网络时，使用独立 Relay + HTTPS，并理解它当前不是生产级公网服务；或叠加 Tailscale/WireGuard

## 不在范围

- 用户主动把服务暴露到公网导致的未授权访问
- 已获得本机文件系统权限后的本地攻击
- 未签名安装包触发的 SmartScreen 提示

## 电脑互联（1.5.0）

- 连接请求必须由主机在客户端中显式批准，默认 60 秒过期
- request id/secret 使用 128-bit 以上随机值；secret 只返回给发起方
- 重复批准、拒绝、过期请求不会签发 token
- 请求按来源 IP + 全局限流，并限制 pending 数量
- 局域网发现 UDP 42081 只广播设备名、实例 ID 和 Hub 端口，不包含配对码、token、文件名或路径
- 防火墙规则必须程序级、仅 Private/Domain，禁止 Public/Any