# Filebridge-Lan 1.4.0

发布日期：2026-10-24

Breaking change：移除 WebRTC 房间，局域网传输统一 HTTP；认证改为“配对码 + bearer token”。

## UI

- 首页两种模式：局域网直传（默认）/ 跨网络中继（实验）
- 局域网以二维码和在线状态为主；配对码移入“手动连接 / 连接详情”
- 状态覆盖读取中、需要配对、连接中、在线、授权过期、服务不可用
- 跨网络中继按 3 步呈现，并持续显示“未完成真实 WAN 验证”警示

## 桌面修复

- 关闭 Tauri 原生 drag-drop 拦截，恢复 WebView2 的 HTML5 文件拖放
- “打开所在文件夹”改为传递完整引号绝对路径，避免 Explorer 回退到“文档”目录

## 移除

- WebRTC 房间、信令服务器、42070 端口
- `?room=` 扫码进房、房间码、WebRTC 小文件通道
- Tauri/Node signaling 模块、`src/transfer`、`src/network` 死代码
- `tsx` 开发依赖

## HTTP 配对与 token

- Hub 启动生成 6 位配对码，只存内存
- 桌面通过 loopback + 本机 Origin 读取 `/api/session`
- 手机扫码 `/#code=...`，或手动输入配对码
- `POST /api/pair` 配对成功后签发 **256-bit token**，12 小时过期
- 文件列表/上传/下载/删除/SSE 全部校验 token；6 位码不能再直接访问文件 API
- 下载/SSE 使用 `?token=`；删除/上传/列表使用 `Authorization: Bearer`
- 轮换：`POST /api/session/rotate`（仅 loopback）清空所有 token
- token/配对码比较使用常量时间；错误统一 401
- 配对失败按 IP 10 次/分钟 + 全局 300 次/分钟限流

## Host/Origin/DNS rebinding

- Host 只接受 `localhost`、`127.0.0.1`、`::1`、本机 LAN IP，端口必须 42080
- Origin 只接受 `http://tauri.localhost`、Hub 自身源、Vite 开发源（5173）
- 拒绝 `null` Origin、任意域名、伪造 Host
- CORS 不再使用 `*`；只回显允许的 Origin
- Node 与 Rust Hub 行为一致

## 防火墙

- 安装器和 `scripts/fix-firewall.ps1` 改为：程序级、TCP、仅 42080、仅 Private/Domain
- 删除旧规则后重建；不再使用 `-Protocol Any`，不加 Public/任意程序规则
- 本次只构建/静态检查，未在本机实际安装或修改防火墙；UAC hook 未实机验证

## 验证

- `npm run test:hub`：Host/Origin 拒绝、session loopback-only、配对 token、无/错 token 401、上传/下载/SHA-256、Range、query token、CORS、删除、轮换、配对限流
- Rust Hub：同源/恶意 Origin、伪造 Host、配对 token、带 token 上传下载、轮换后旧 token 401
- 桌面 UI 自动配对；手机无码提示、带 `#code` 自动配对
- `npm run check` / `npm run build` / `cargo check` / `cargo test` / NSIS 构建通过
- 42070 不再监听

## 跨网络中继

- 增加 downloadToken；元数据/分片下载需要 token
- 增加 accessToken：公网实例必须设置，创建传输需要访问令牌
- 非 loopback 直连 HTTP 拒绝（426）；必须 HTTPS 反向代理
- 增加可信代理 XFF 右向左解析、IP/全局限流、上传/下载并发上限
- 存储配额创建时原子预留，避免并发超卖
- 增加分片预期大小校验、最终文件大小/SHA-256 校验；hash 只在链接 fragment
- **仍是实验性功能**：没有完成“手机蜂窝网络 + 电脑另一网络”的真实 WAN 验证；中继可见元数据；无正式账号/滥用处理，不应作为生产级公网服务
- 本地/same-host 的结果不能替代 WAN 验证

## 安装

安装包由 GitHub Actions 在 tag `v1.4.0` 上构建并上传，SHA-256 见 Release 资产 digest 和发布正文。

- 安装结束如出现 UAC，请允许一次（TCP 42080 防火墙规则）
- 安装包未签名，未构建 MSI

## 已知限制

- 局域网 HTTP 明文；token 不是加密
- 未实现上传断点续传
- 中继需要自行部署 HTTPS；当前非生产级
- 跨网络接收端在内存组装 Blob，超大文件受手机内存限制
