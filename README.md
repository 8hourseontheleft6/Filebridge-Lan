# Filebridge-Lan

局域网文件传输工具：手机浏览器 ↔ 电脑。手机扫码即可打开，大文件走 HTTP 直传；小文件可选 WebRTC 房间。

> 原名 **FileBridge**，1.2.0 起更名为 **Filebridge-Lan**，定位仍是局域网优先。等支持公网传输后再考虑新的命名。
>
> 源码：[github.com/8hourseontheleft6/Filebridge-Lan](https://github.com/8hourseontheleft6/Filebridge-Lan)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20LAN-lightgrey.svg)](#)
[![CI](https://github.com/8hourseontheleft6/Filebridge-Lan/actions/workflows/ci.yml/badge.svg)](https://github.com/8hourseontheleft6/Filebridge-Lan/actions/workflows/ci.yml)

## 特点

- **手机免安装**：同一 WiFi 下扫码打开网页，直接上传/下载
- **大文件直传**：浏览器流式上传，电脑流式写盘；1 GB 文件 release 实测上传约 2–2.5 s、下载约 1.5–2.3 s（本机回环）
- **扫码进房间**：创建 WebRTC 房间后生成 `?room=` 二维码，手机扫码自动加入
- **桌面端原生保存**：下载进度、取消、`.part` 原子写入、同名文件去重
- **电脑端实时接收进度**：手机上传时通过 SSE 显示百分比/速度/剩余时间
- **Tauri 内嵌服务**：桌面应用内置 Rust Hub（42080）和 Rust 信令（42070），不依赖 Node
- **跨网络加密中继**：文件在本机 AES-GCM 加密后上传，中继只保存密文；手机凭链接/传输码接收
- **无外网依赖（局域网模式）**：运行时不访问云端；HTTP/信令只在局域网内；跨网络模式才连接你配置的中继

## 直接安装（Windows）

从 [GitHub Releases](https://github.com/8hourseontheleft6/Filebridge-Lan/releases) 下载 `Filebridge-Lan_1.3.0_x64-setup.exe`，或本地构建：

```bash
npm install
npm run tauri build
```

产物：`src-tauri/target/release/bundle/nsis/Filebridge-Lan_1.3.0_x64-setup.exe`

- 默认按当前用户安装到 `%LOCALAPPDATA%\Filebridge-Lan`
- 安装结束时如出现 **UAC** 提示，请允许一次：用于移除防火墙 Block 规则并放行专用网络
- 安装包未签名，Windows SmartScreen 可能提示“未知发布者”
- 首次运行如防火墙弹窗，请允许专用网络（TCP 42070 / 42080）
- SHA-256 见 GitHub Release 的资产 digest

版本说明：[docs/RELEASE-1.3.0.md](docs/RELEASE-1.3.0.md)

> 从旧 FileBridge 升级：1.2.x 使用新的应用标识，旧版本会保留；首次启动会尝试把 `Downloads\FileBridge` 数据目录迁移到 `Downloads\Filebridge-Lan`。

## 从源码开发

要求：Node.js ≥ 18、Rust stable、Windows WebView2（通常系统已带）。

```bash
npm install
npm run dev:all      # Node Hub + Node 信令 + Vite :5173
```

桌面开发：

```bash
npm run tauri dev    # 启动 Tauri，同时拉起 Rust Hub/信令
```

> `dev:all`（Node 服务）和 `tauri dev`（Rust 服务）端口相同，不要同时运行。

浏览器访问 `http://localhost:5173`，手机访问 `http://<电脑IP>:42080`。

跨网络中继（本地开发，可选）：

```bash
npm run build
BRIDGE_PUBLIC_URL=http://127.0.0.1:43000 npm run bridge
```

Windows PowerShell 使用：

```powershell
$env:BRIDGE_PUBLIC_URL = 'http://127.0.0.1:43000'
npm run bridge
```

默认监听 `43000`。公网部署必须加 HTTPS，详见 [docs/CROSS-NETWORK.md](docs/CROSS-NETWORK.md)。

## 使用

- 手机与电脑连同一 WiFi，扫描首页二维码即可打开传输页
- 首页选择文件上传；电脑端文件列表点“保存”下载
- 右上角 **⚙ 设置** 可修改电脑端下载目录
- 创建 WebRTC 房间后，手机扫描房间二维码自动加入
- **跨网络**：在首页“跨网络传输”面板里配置中继地址，选择文件上传后会生成接收链接/二维码；手机打开链接即可解密下载

跨网络流程：

```text
发送方本地 AES-GCM 加密 → 分片上传到中继 → 生成 #receive=code&key=链接
接收方打开中继页面 → 拉取密文分片 → 本地解密 → 浏览器下载
```

中继只保存密文；密钥在 URL `#` 后，不会发送到服务器。中继实现与部署见 [docs/CROSS-NETWORK.md](docs/CROSS-NETWORK.md)。

### 手机打不开，但电脑端正常？

通常是 Windows 防火墙阻止了 `filebridge-lan.exe`。`npm run hub` 用的是 `node.exe`，已有 Allow 规则，所以能访问。

1.2.1 安装器会请求一次 UAC 并自动修复。已经安装 1.2.0 的，以管理员身份运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\fix-firewall.ps1
```

也可以手动执行：

```powershell
Get-NetFirewallRule -DisplayName 'filebridge-lan.exe' | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'Filebridge-Lan' -Direction Inbound `
  -Program "$env:LOCALAPPDATA\Filebridge-Lan\filebridge-lan.exe" `
  -Action Allow -Protocol TCP -Profile Private,Domain
```

其他检查：

- 电脑与手机在同一 WiFi，路由器未开启 AP 隔离
- Windows 网络配置为“专用”而不是“公用”
- 手机打开 `http://<电脑IP>:42080/api/info`，能返回 JSON 说明端口已通
- 确认 42080/42070 没有被旧进程/Node Hub 占用；`npm run hub` 与 App 不要同时跑

## 架构

```text
局域网模式：
手机浏览器 ──HTTP──> Rust axum Hub (:42080) ──流式写盘──> Downloads/Filebridge-Lan
     │                    │
     └──WebSocket──> Rust 信令 (:42070) ──WebRTC DataChannel──> 桌面端

跨网络模式：
发送方 ──AES-GCM 分片加密──> Bridge Relay (:43000 / 公网) ──密文分片──> 对象存储/磁盘
接收方 <──HTTPS 密文分片── Bridge Relay <──#receive=code&key= 链接/二维码
```

- HTTP Hub 负责局域网大文件上传/下载、SHA-256、Range、SSE 进度
- 信令只中继 Offer/Answer/ICE，不传文件
- WebRTC 房间模式仅适合 ≤64KB 小文件；大文件走 HTTP
- Bridge Relay 只保存 AES-GCM 密文；解密密钥在链接 fragment 里
- 详细 API：[docs/HTTP-HUB.md](docs/HTTP-HUB.md) · 跨网络：[docs/CROSS-NETWORK.md](docs/CROSS-NETWORK.md)

## 项目结构

```text
Filebridge-Lan/
├── src/                    # React + Vite 前端
├── src-tauri/              # Tauri / Rust Hub / 信令
│   ├── src/hub.rs
│   ├── src/signaling.rs
│   ├── src/downloads.rs    # 原生保存：进度/取消/原子写入
│   └── capabilities/       # Tauri 权限
├── server/                 # Node Hub / 信令 / 加密中继
│   ├── hub.mjs
│   ├── signaling.ts
│   └── bridge.mjs          # 跨网络加密中继（:43000）
├── src/relay/              # 跨网络 UI + AES-GCM 分片加密
├── scripts/                # Hub/Relay 冒烟测试与上传基准
├── docs/                   # API、架构、跨网络、发布记录
└── release/                # 本地安装包（gitignore）
```

## 测试

```bash
npm run check
npm run build
npm run test:hub        # Node Hub 11 项冒烟测试
npm run test:bridge     # 加密中继 API 冒烟测试
cargo test --manifest-path src-tauri/Cargo.toml
```

当前没有正式浏览器 E2E；扫码/自动加入/跨网络收发曾用 headless Chrome 验证。欢迎补 Playwright。

## 安全与隐私

- **局域网模式**：HTTP、SSE、信令均为明文，Hub 没有鉴权；仅限可信局域网
- **跨网络模式**：客户端 AES-GCM 端到端加密，中继只保存密文；链接 fragment 中的密钥不会发送到服务器
- **不要暴露局域网 Hub 到公网**：不要把 42080/42070 映射到公网；跨网络请用独立 Relay + HTTPS
- 中继仍能看到文件名、大小、传输码、IP 和时间等元数据；TTL 到期自动删除
- 文件只保存在本机 `Downloads/Filebridge-Lan`、用户选择的下载目录或中继密文目录
- 运行时不包含遥测；安装包内嵌 WebView2 bootstrapper，缺失时需联网下载
- 安全问题请按 [SECURITY.md](SECURITY.md) 私下报告

## 已知限制

- 局域网模式未实现上传断点续传
- 跨网络中继未实现断点续传/账号/按用户配额；默认单文件 2GB、总存储 8GB、TTL 24h
- 跨网络接收端会在浏览器内存中组装 Blob，超大文件可能受手机内存限制
- 中继需要自行部署 HTTPS；仓库只提供 Node 服务，不提供托管实例
- WebRTC 仅适合小文件
- 安装包未签名，未构建 MSI
- Windows 以外平台未做发布验证

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。提交前请跑 `npm run check`、`npm run test:hub`、`npm run test:bridge` 和 `cargo test`。

## 许可证

本项目使用 [MIT License](LICENSE)。第三方依赖许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 致谢

- 早期原型由 Cline 辅助开发
- Tauri、axum、React、Vite 及所有依赖的作者
