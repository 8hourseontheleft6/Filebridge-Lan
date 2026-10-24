# FileBridge 1.1.0

> 历史版本：本记录使用旧名 FileBridge；当前版本见 [RELEASE-1.2.0.md](RELEASE-1.2.0.md)。

> ⚠️ 1.1.0 的 Tauri 安装版存在页面 API 地址错误（`tauri.localhost`），打开会显示离线/无二维码。请使用 **1.1.3**：见 [RELEASE-1.1.3.md](RELEASE-1.1.3.md)。

发布日期：2026-10-23

## 下载

| 项目 | 值 |
|---|---|
| 安装包 | `FileBridge_1.1.0_x64-setup.exe` |
| 大小 | 4.86 MB |
| SHA-256 | `cc86d35d2da444a584069aca1cbdb36148faef6a8617990999acdac69f454d5f` |
| 平台 | Windows 10/11 x64 |
| 签名 | 未签名（Windows SmartScreen 可能提示“未知发布者”） |

构建产物原始路径：`src-tauri/target/release/bundle/nsis/FileBridge_1.1.0_x64-setup.exe`。
本机已复制到 `release/`（该目录已 gitignore）。

## 安装

1. 双击 `FileBridge_1.1.0_x64-setup.exe`。
2. 默认按当前用户安装到 `%LOCALAPPDATA%\FileBridge`，不需要管理员权限。
3. 首次启动如果 Windows 防火墙弹窗，请允许 **专用网络**（TCP 42080 / 42070）。
4. 电脑打开应用后，手机与电脑连同一 WiFi，扫描界面二维码即可开始传文件。

> 安装包内嵌 WebView2 bootstrapper；如果目标机器没有 WebView2 Runtime，安装阶段需要联网下载一次。

## 1.1.0 亮点

- **HTTP 直传**：手机浏览器 ↔ 电脑，浏览器原生上传/下载，电脑流式写盘；1 GB 文件 release 实测上传约 2–2.5 s、下载约 1.5–2.3 s（本机回环）。
- **手机扫码**：首页二维码直接打开传输页；创建 WebRTC 房间后生成 `?room=` 二维码，手机扫码自动加入，失败自动重试并显示重试入口。
- **Rust 内嵌服务**：Tauri 同时启动 Rust axum Hub（42080）和 Rust 信令（42070），发布包不依赖 Node。
- **UI 完善**：状态徽章、上传百分比/速度/剩余时间、复制链接/房间码、文件图标、空状态、移动端 390px 适配。
- **真实设备验证**：用户已用手机成功扫码接收 **500 MB 视频** 与 **1 GB ISO**。

## 已验证

- `npm run check`、`npm run build` 通过
- `npm run test:hub`：11 项通过（上传/下载/哈希/Range/空文件/清洗/CORS/删除）
- `cargo test`：2/2 通过
- Tauri NSIS 构建成功，主程序为 `filebridge.exe`
- 静默安装 → 启动 → 卸载验证通过：安装后 `42080/42070` 由同一进程监听，`/api/info` 返回 `1.1.0`，内置页面返回 200
- Headless Chrome 验证扫码房间：桌面创建房间 → 手机打开 `?room=` → 自动加入 → P2P 连接已建立
- 移动端 390px：`scrollWidth=390`，无横向溢出

## 已知限制

- 安装包未做代码签名，SmartScreen 可能拦截；正式分发建议购买代码签名证书。
- 未实现上传断点续传、桌面端 SSE 实时进度、访问 token/密码。
- WebRTC 房间模式仅支持 ≤64KB 小文件；大文件请使用 HTTP 直传。
- HTTP/信令在局域网内为明文传输，且 Hub 没有鉴权；不要把 42080/42070 暴露到公网。
- 本次只产出 NSIS 安装包，未构建 MSI。

## 重新构建

```bash
npm install
npm run tauri build
```

产物：`src-tauri/target/release/bundle/nsis/FileBridge_<version>_x64-setup.exe`
