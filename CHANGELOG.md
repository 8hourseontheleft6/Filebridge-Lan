# Changelog

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
