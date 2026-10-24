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
- **无外网依赖**：运行时不访问云端；HTTP/信令只在局域网内

## 直接安装（Windows）

从 [GitHub Releases](https://github.com/8hourseontheleft6/Filebridge-Lan/releases) 下载 `Filebridge-Lan_1.2.0_x64-setup.exe`，或本地构建：

```bash
npm install
npm run tauri build
```

产物：`src-tauri/target/release/bundle/nsis/Filebridge-Lan_1.2.0_x64-setup.exe`

- 大小 5.0 MB
- SHA-256 `206fd21b312f4e9fc022ecfef2d0b759296f7a6ca1e8dbb3d3c2f6957e6fd572`
- 默认按当前用户安装到 `%LOCALAPPDATA%\Filebridge-Lan`
- 安装包未签名，Windows SmartScreen 可能提示“未知发布者”
- 首次运行如防火墙弹窗，请允许专用网络（TCP 42070 / 42080）

> 从旧 FileBridge 升级：1.2.0 使用新的应用标识，旧版本会保留；首次启动会尝试把 `Downloads\FileBridge` 数据目录迁移到 `Downloads\Filebridge-Lan`。

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

## 使用

- 手机与电脑连同一 WiFi，扫描首页二维码即可打开传输页
- 首页选择文件上传；电脑端文件列表点“保存”下载
- 右上角 **⚙ 设置** 可修改电脑端下载目录
- 创建 WebRTC 房间后，手机扫描房间二维码自动加入

## 架构

```
手机浏览器 ──HTTP──> Rust axum Hub (:42080) ──流式写盘──> Downloads/Filebridge-Lan
     │                    │
     └──WebSocket──> Rust 信令 (:42070) ──WebRTC DataChannel──> 桌面端
```

- HTTP Hub 负责大文件上传/下载、SHA-256、Range、SSE 进度
- 信令只中继 Offer/Answer/ICE，不传文件
- WebRTC 房间模式仅适合 ≤64KB 小文件；大文件走 HTTP
- 详细 API：[docs/HTTP-HUB.md](docs/HTTP-HUB.md) · 架构：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## 项目结构

```text
Filebridge-Lan/
├── src/                    # React + Vite 前端
├── src-tauri/              # Tauri / Rust Hub / 信令
│   ├── src/hub.rs
│   ├── src/signaling.rs
│   ├── src/downloads.rs    # 原生保存：进度/取消/原子写入
│   └── capabilities/       # Tauri 权限
├── server/                 # 浏览器开发用 Node Hub/信令
├── scripts/                # Hub 冒烟测试与上传基准
├── docs/                   # API、架构、路线图、发布记录
└── release/                # 本地安装包（gitignore）
```

## 测试

```bash
npm run check
npm run build
npm run test:hub        # Node Hub 11 项冒烟测试
cargo test --manifest-path src-tauri/Cargo.toml
```

当前没有正式浏览器 E2E；扫码/自动加入曾用 headless Chrome 验证。欢迎补 Playwright。

## 安全与隐私

- **仅限可信局域网**：HTTP、SSE、信令均为明文，Hub 没有鉴权
- **不要暴露到公网**：不要把 42080/42070 映射到公网
- 文件只保存在本机 `Downloads/Filebridge-Lan` 与用户选择的下载目录
- 运行时不包含遥测；安装包内嵌 WebView2 bootstrapper，缺失时需联网下载
- 安全问题请按 [SECURITY.md](SECURITY.md) 私下报告

## 已知限制

- 未实现上传断点续传
- 没有访问 token/密码、TLS
- WebRTC 仅适合小文件
- 安装包未签名，未构建 MSI
- Windows 以外平台未做发布验证

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。提交前请跑 `npm run check`、`npm run test:hub` 和 `cargo test`。

## 许可证

本项目使用 [MIT License](LICENSE)。第三方依赖许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 致谢

- 早期原型由 Cline 辅助开发
- Tauri、axum、React、Vite 及所有依赖的作者
