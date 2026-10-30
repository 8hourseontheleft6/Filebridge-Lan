# Changelog

## 1.5.0 - WIP

- 电脑端 UDP 42081 局域网发现和“附近电脑”卡片
- 连接请求/主机确认协议（Node + Rust Hub）
- 浏览器免安装页打开后自动等待主机确认
- 主机确认弹窗提升到应用层，切换到中继页也能处理请求
- 附近电脑显示“等待确认/已连接”状态
- 并发 pending 上限测试与 token 重复轮询一致性测试
- 请求 ID/secret 随机、60 秒过期、限流、pending 上限、重复批准保护
- 发现广播不含配对码、token、文件名或路径
- 防火墙脚本增加 UDP 42081 Private/Domain

## 1.4.4 - 2026-10-30

- 修复 861–1050px 桌面窗口下卡片只占左半边的问题
- 删除旧的 1050px 双列覆盖，三张主卡片统一同宽
- 上传/下载速率卡片在正常桌面宽度下并排显示

## 1.4.3 - 2026-10-30

- “扫码连接”移到“文件列表”上方
- 扫码连接、文件列表、传输进度统一为同宽纵向排列
- 保留 1.4.2 的批量操作、速率卡片、设置说明和安全边界

## 1.4.2 - 2026-10-30

- 界面改为浅色卡片仪表盘：侧边导航、文件列表、扫码连接、传输进度分区
- 文件列表支持勾选、多选、全选、批量保存/下载和批量删除
- 文件列表增加高度限制和可拖动滚动条
- 增加上传/下载速率卡片：当前速度、峰值、累计和曲线
- 设置页增加版本、传输原理、存储位置和安全说明
- 修复 Rust 内置 Hub 版本号未同步的问题

## 1.4.1 - 2026-10-25

- 局域网二维码区域增加“显示 code / 隐藏 code”按钮；默认隐藏，点击后可直接查看链接末尾的配对码
- 复制链接始终复制完整链接，不受显示状态影响
- 保留 1.4.0 的配对 token、Host/Origin、防火墙和桌面拖放/打开目录修复

## 1.4.0 - 2026-10-24

移除 WebRTC 房间，HTTP 直传改为“配对码 + bearer token”；UI 改为局域网/跨网络中继两种模式。**Breaking change。**

### 认证与安全

- Hub 启动生成 6 位配对码；桌面通过 loopback + 本机 Origin 读取 `/api/session`
- 二维码 `/#code=...`；手机扫码/输入配对码后 `POST /api/pair`
- 配对成功签发 256-bit token，12 小时过期；文件列表/上传/下载/删除/SSE 只接受 token
- 6 位码不再作为文件 API 凭据；token 校验常量时间
- 失败按 IP 10 次/分钟 + 全局 300 次/分钟限流；轮换会清空所有 token
- Host/Origin 白名单：Tauri、Hub 自身、Vite；拒绝 null Origin、任意域名、伪造 Host、DNS rebinding
- CORS 移除 `*`，只回显允许 Origin
- 防火墙改为程序级 TCP 42080、Private/Domain；移除 Any

### 移除

- WebRTC 房间、`server/signaling.ts`、`src-tauri/src/signaling.rs`
- 42070 信令端口、`?room=` 扫码进房、房间码 UI
- `src/transfer`、`src/network` 死代码
- `tsx` 开发依赖

### 跨网络中继

- 增加 downloadToken；元数据/分片下载鉴权
- 公网实例必须设置 `BRIDGE_ACCESS_TOKEN`；创建传输需要访问令牌
- 非 loopback 强制 HTTPS（426）；可信代理 XFF 右向左解析
- IP + 全局限流、上传/下载并发上限；存储配额原子预留
- 分片预期大小、最终大小和 SHA-256 校验；hash 只在 fragment
- 仍是实验性功能，未完成真实 WAN 验证；不声称生产可用

### 桌面修复

- 关闭 Tauri 原生 drag-drop 拦截，恢复 WebView2 的 HTML5 文件拖放
- 修复“打开所在文件夹”使用 Explorer `/select` 时路径未作为完整带引号绝对路径传递的问题；避免打开“文档”默认目录

### 验证

- Node Hub 冒烟：Host/Origin、配对 token、401、上传/下载/Range/query token/CORS/删除/轮换/配对限流
- Rust Hub：恶意 Origin/Host、配对 token、上传下载、轮换后 token 失效
- 桌面 UI 自动配对；手机无码提示、带 `#code` 自动配对
- `npm run check` / `npm run build` / Tauri NSIS 构建通过
- 42070 不再监听

## 1.3.1 - 2026-10-24

修复 WebRTC 房间一直停在“连接中”。

### 修复

- Tauri WebView2 关闭 mDNS host 候选隐藏（`WebRtcHideLocalIpsWithMdns`），使用局域网 IP 候选，修复 iPhone/Safari 无法解析 `.local`
- 安装器防火墙规则由 TCP 改为 **Any**（TCP/UDP），仍限 Private/Domain
- 手动修复脚本同步支持 UDP
- Rust 信令先发 `room_joined` 再通知 host `peer_joined`

### 验证

- Tauri host + Chromium 手机页 ICE 连接成功
- host 候选由 `xxx.local` 变为 `192.168.2.43`
- 1.3.1 NSIS 构建成功

## 1.3.0 - 2026-10-24

新增跨网络加密中继（实验性）。

### 新增

- `server/bridge.mjs`：独立 Relay（:43000），传输码、上传令牌、TTL、配额、限流
- AES-256-GCM 4MB 分片加密；key 放在 URL fragment，中继只保存密文
- 跨网络发送/接收面板、二维码、进度、取消
- Relay 同时托管 `dist/`，手机打开公网链接即可接收
- `docs/CROSS-NETWORK.md`：API、部署、安全模型

### 验证

- 1MB 文件浏览器 E2E 收发，下载 SHA-256 与源文件一致
- 中继磁盘分片为密文（明文 + 28 字节）
- `npm run test:bridge` 9 项通过
- CI 增加 Bridge smoke test

## 1.2.1 - 2026-10-24

修复安装版下手机无法访问 Rust Hub 的防火墙问题。

### 修复

- 根因：Windows 防火墙存在 `filebridge-lan.exe` 的 Block/Private 入站规则；Node Hub（`node.exe`）有 Allow 规则，所以 `npm run hub` 能访问
- NSIS 安装器新增防火墙 hook：安装结束时请求一次 UAC，移除 Block 规则并添加 Private/Domain TCP Allow
- 新增 `scripts/fix-firewall.ps1` 供已安装 1.2.0 的用户手动修复
- 设置面板与 README 增加“手机打不开”排障说明
- Release workflow 自动把安装包 SHA-256 写入发布正文

### 验证

- App 单独启动时 Hub 监听 `0.0.0.0:42080`，本机 `/` 返回 200
- 防火墙修复后不再有 `filebridge-lan.exe` Block 规则
- 手机与电脑在同一专用网络时可访问 `http://<电脑IP>:42080/`

## 1.2.0 - 2026-10-24

首个以 Filebridge-Lan 名称发布的开源版本（MIT）。

### 改名 / 应用身份

- 项目名 `FileBridge` → `Filebridge-Lan`
- 可执行文件 `filebridge-lan.exe`，应用标识 `com.filebridgelan.desktop`
- 安装目录 `%LOCALAPPDATA%\Filebridge-Lan`
- 数据目录 `Downloads\Filebridge-Lan`，首次启动从旧 `Downloads\FileBridge` 迁移
- 环境变量改为 `FILEBRIDGE_LAN_*`

### 开源 / 工程

- 新增 MIT LICENSE、SECURITY.md、CONTRIBUTING.md、THIRD_PARTY_NOTICES.md
- 新增 Windows GitHub Actions CI
- 移除未使用的 `react-router-dom`
- `npm audit` 0 漏洞；Vite 升级到 6.4.5

### 验证

- 安装后 `/api/info` 返回 `Filebridge-Lan Hub` / `1.2.0`
- 首页“在线”+二维码正常，数据目录迁移保留旧文件
- `npm run check`、`npm run build`、`npm run test:hub`（11 项）、`cargo check`、`cargo test`（2 项）通过

## 1.1.3 - 2026-10-24

大文件下载进度/取消，以及电脑端实时接收进度。

### 新增

- 桌面端下载进度：百分比、速度、剩余时间，支持取消
- 原子写入：先写 `.part`，成功后原子重命名；取消/失败自动清理
- SSE `/api/events`：手机上传时电脑端实时显示接收进度，完成/失败有 Toast
- 新增 `src-tauri/capabilities/default.json`，授予 `core:default` 以监听 Tauri 事件

### 修复

- Hub 在 stdout 不可用时，上传完成日志的 `println!` 可能 panic，导致 HTTP 响应和 `completed` SSE 事件丢失；现已改为安全日志
- 上传响应在后台/无控制台启动时不再出现空响应

### 验证

- 512 MB 下载：进度 0%→42%→57%→100%，约 1.07 GB/s，完成后文件大小 536,870,912 bytes，无 `.part`
- 512 MB 下载取消：返回“已取消”，目标目录为空
- 重复保存：提示“文件已存在，未重复保存”，仍只有 1 份
- 512 MB 上传（限速 30 MB/s）：电脑端显示 41%→100%、约 30 MB/s 和剩余时间；完成 Toast 正常
- Node Hub SSE：`started → progress → completed`
- `npm run test:hub` 11 项、`cargo test` 2 项、`npm run check` 均通过

## 1.1.2 - 2026-10-24

桌面端下载体验与下载目录设置。

### 新增

- 桌面端下载改走 Rust 保存：保存完成/失败显示 Toast，并可直接“打开”所在文件夹
- 首页 **⚙ 设置**：自定义电脑端下载目录、选择文件夹、恢复默认、打开文件夹；设置持久化
- 下载防重复：保存中禁用按钮；目标目录已有同名且大小相同的文件时提示“文件已存在”，不再生成副本
- 文件名不再作为隐式下载链接，避免误点产生多份文件

### 验证

- 1.1.2 覆盖安装 1.1.1 成功
- 保存测试文件后 Toast 显示“下载完成：C:\Users\user\Downloads\...”，文件存在
- 再次点击显示“文件已存在，未重复保存”，Downloads 中仍只有 1 份
- 设置自定义目录后下载写入 `Downloads\FileBridgeTest`，随后恢复默认成功
- `/api/info` 返回 `1.1.2`，42070/42080 由同一进程监听

## 1.1.1 - 2026-10-24

Tauri 安装版连接失败修复。

### 修复

- Tauri 生产页面 origin 是 `http://tauri.localhost`，前端把 API/信令地址拼成了 `tauri.localhost:42080/42070`，被 Tauri 协议截获导致“离线 / 连接失败 / 无二维码”。
- 现在 Tauri 环境固定使用 `http://127.0.0.1:42080` 与 `ws://127.0.0.1:42070`；手机浏览器仍使用当前局域网 IP。

### 验证

- 从 1.1.0 覆盖安装 1.1.1 成功
- 安装版页面 `http://tauri.localhost/` 显示“在线”和首页二维码
- 创建房间成功生成 `http://192.168.1.100:42080/?room=786672` 房间二维码，无连接失败
- 安装版 Hub `/api/info` 返回 `1.1.1`，42070/42080 由同一进程监听

## 1.1.0 - 2026-10-23

首个可安装的 Windows 版本。

### 新增

- HTTP 直传：手机浏览器与电脑之间流式上传/下载，大文件不占手机内存
- 手机扫码：首页二维码打开传输页；房间二维码带 `?room=`，扫码自动加入
- Rust axum 内嵌 Hub（42080）与信令（42070），Tauri 发布包不需要 Node
- Tauri NSIS 安装包，支持当前用户安装
- UI：上传百分比/速度/ETA、复制链接/房间码、状态徽章、文件图标、空状态、移动端适配

### 修复

- WebRTC 大文件接收静默丢数据/卡死：发送错误传播、超时、接收看门狗、日志节流、0 字节/取消处理
- Tauri 多二进制场景下主程序选择错误（`mainBinaryName`）
- release 资源路径与手机端页面加载

### 验证

- 真实手机扫码接收 500 MB 视频、1 GB ISO 成功
- Hub 冒烟测试 11 项、Rust 单测 2 项通过
- 安装包静默安装/启动/卸载验证通过

详细安装包信息见 [docs/RELEASE-1.1.0.md](docs/RELEASE-1.1.0.md)。

## 1.0.0 - 2026-05-31

- 初版 FileBridge（早期原型）
