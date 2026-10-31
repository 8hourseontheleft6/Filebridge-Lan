# Filebridge-Lan

> 局域网文件传输工具：手机浏览器 ↔ 电脑。手机扫码即可打开，大文件走 HTTP 直传。
>
> 源码：[github.com/8hourseontheleft6/Filebridge-Lan](https://github.com/8hourseontheleft6/Filebridge-Lan)

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20LAN-lightgrey.svg)](#)
[![CI](https://github.com/8hourseontheleft6/Filebridge-Lan/actions/workflows/ci.yml/badge.svg)](https://github.com/8hourseontheleft6/Filebridge-Lan/actions/workflows/ci.yml)

## 特点

- **手机免安装**：扫码打开网页即可上传/下载
- **HTTP 直传**：流式上传、SHA-256、Range 下载、SSE 进度
- **两种模式**：局域网直传默认选中；跨网络中继（实验）单独入口
- **电脑互联**：局域网自动发现附近电脑；主机确认后连接。另一台电脑也可直接用浏览器发起请求，无需安装
- **网络类型门禁**：只有 Private/Domain 才启动 UDP 发现和局域网 Hub；公用网络弹窗提示修改，且关闭弹窗不能绕过门禁
- **文件管理**：多选、全选、批量保存/下载、批量删除；文件列表限高并带滚动条
- **传输仪表盘**：上传/下载当前速度、峰值、累计传输量和实时曲线
- **配对码 + token**：6 位码只用于配对；配对后签发 12 小时有效的随机 token；配对码放在手动连接/详情折叠区，二维码链接可一键显示/隐藏 code
- **大文件**：纯 HTTP，不使用 WebRTC
- **Tauri 内嵌 Hub**：桌面应用内置 Rust Hub（42080），不依赖 Node
- **跨网络加密中继**：实验性；文件在本机 AES-GCM 加密后上传，中继只保存密文
- **无外网依赖（局域网模式）**：运行时只在局域网内通信

## 直接安装（Windows）

从 [GitHub Releases](https://github.com/8hourseontheleft6/Filebridge-Lan/releases) 下载 `Filebridge-Lan_1.5.0_x64-setup.exe`，或本地构建：

```bash
npm install
npm run tauri build
```

产物：`src-tauri/target/release/bundle/nsis/Filebridge-Lan_1.5.0_x64-setup.exe`

- 默认按当前用户安装到 `%LOCALAPPDATA%\Filebridge-Lan`
- 安装结束时如出现 **UAC** 提示，请允许一次：移除防火墙 Block 规则，并放行专用网络的 TCP 42080 + UDP 42081
- 安装包未签名，Windows SmartScreen 可能提示“未知发布者”
- 首次运行如防火墙弹窗，请允许专用网络（TCP 42080 + UDP 42081）
- SHA-256 见 GitHub Release 的资产 digest

版本说明：[docs/RELEASE-1.5.0.md](docs/RELEASE-1.5.0.md)

> 从旧版本升级：首次启动会尝试把 `Downloads\FileBridge` 数据目录迁移到 `Downloads\Filebridge-Lan`。

## 从源码开发

```bash
npm install
npm run dev:all      # Node Hub + Vite :5173
npm run tauri dev    # Tauri，同时拉起 Rust Hub
```

浏览器访问 `http://localhost:5173`，手机访问 `http://<电脑IP>:42080`。

跨网络中继（可选）：

```bash
npm run build
BRIDGE_PUBLIC_URL=http://127.0.0.1:43000 npm run bridge
```

默认监听 `43000`。公网部署必须加 HTTPS，详见 [docs/CROSS-NETWORK.md](docs/CROSS-NETWORK.md)。

## 使用

1. 电脑打开 Filebridge-Lan，首页显示 **6 位配对码** 和二维码
2. 手机扫码打开 `http://<电脑IP>:42080/#code=...`，配对码自动带入
3. 手动输入网址时，手机页面会要求输入电脑上显示的 6 位配对码
4. 手机或电脑选择文件上传；文件出现在列表里
5. 手机点下载直接走浏览器；电脑可保存到自定义下载目录

配对码只用于换取 bearer token；文件列表、上传、下载、删除和 SSE 都校验 token。token 有效期 12 小时，Hub 重启或轮换配对码后失效。

### 跨网络

在首页切换到“跨网络中继（实验）”，配置 Relay 地址和（公网实例的）access token，上传后会生成完整接收链接/二维码。中继只保存密文，密钥、downloadToken 和文件 SHA-256 在 URL `#` 后，不发送到服务器。见 [docs/CROSS-NETWORK.md](docs/CROSS-NETWORK.md)。

> 跨网络中继是**实验性**功能；公网实例必须设置 `BRIDGE_ACCESS_TOKEN`，非 loopback 必须 HTTPS。当前未完成手机蜂窝网络 + 电脑另一网络的真实 WAN 验证，不能称为生产级公网中继。中继可见文件大小、时间、传输码、IP 等元数据。接收方必须打开完整链接，不能只发送 8 位传输码。

### 手机打不开，但电脑端正常？

通常是 Windows 防火墙阻止了 `filebridge-lan.exe`。以管理员身份运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\fix-firewall.ps1
```

或手动：

```powershell
Get-NetFirewallRule -DisplayName 'filebridge-lan.exe' | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'Filebridge-Lan' -Direction Inbound `
  -Program "$env:LOCALAPPDATA\Filebridge-Lan\filebridge-lan.exe" `
  -Action Allow -Protocol TCP -LocalPort 42080 -Profile Private,Domain
New-NetFirewallRule -DisplayName 'Filebridge-Lan Discovery' -Direction Inbound `
  -Program "$env:LOCALAPPDATA\Filebridge-Lan\filebridge-lan.exe" `
  -Action Allow -Protocol UDP -LocalPort 42081 -Profile Private,Domain
```

其他检查：

- 电脑与手机在同一 WiFi，路由器未开启 AP 隔离
- Windows 网络配置为“专用”而不是“公用”
- 手机打开 `http://<电脑IP>:42080/api/info`，能返回 JSON 说明端口已通
- 确认 42080 没有被旧进程/Node Hub 占用；`npm run hub` 与 App 不要同时跑
- 配对码错误会提示重新输入；连续错误会按 IP/全局短暂限流

## 架构

```text
手机浏览器 ──HTTP──> Rust axum Hub (:42080) ──流式写盘──> Downloads/Filebridge-Lan
                          │
                          ├─ /api/session（仅 loopback，桌面读取配对码）
                          ├─ /api/pair（配对码 → 12h bearer token）
                          ├─ /api/files /upload /events（token 校验）
                          └─ 静态页面

跨网络：
发送方 ──AES-GCM 分片加密──> Bridge Relay (:43000 / 公网) ──密文分片──> 存储
接收方 <──HTTPS 密文分片── Bridge Relay <──#receive=code&key= 链接/二维码
```

- HTTP Hub 负责上传/下载、SHA-256、Range、SSE 进度
- 配对码/token 是访问控制，不是加密；局域网 HTTP 仍是明文
- Bridge Relay 只保存 AES-GCM 密文
- 详细 API：[docs/HTTP-HUB.md](docs/HTTP-HUB.md) · 跨网络：[docs/CROSS-NETWORK.md](docs/CROSS-NETWORK.md)

## 项目结构

```text
Filebridge-Lan/
├── src/                    # React + Vite 前端
│   ├── http/               # HTTP 直传 + 配对/token 入口
│   ├── relay/              # 跨网络加密中继客户端
│   └── components/         # 二维码、设置等
├── src-tauri/              # Tauri / Rust Hub
│   ├── src/hub.rs          # 文件 API + 配对/token
│   ├── src/downloads.rs    # 原生保存：进度/取消/原子写入
│   └── capabilities/
├── server/                 # Node Hub / 加密中继
│   ├── hub.mjs
│   └── bridge.mjs
├── scripts/                # Hub/Relay 冒烟测试与修复脚本
├── docs/                   # API、架构、跨网络、发布记录
└── release/                # 本地安装包（gitignore）
```

## 测试

```bash
npm run check
npm run build
npm run test:hub        # Node Hub 冒烟测试（含配对/鉴权）
npm run test:bridge     # 加密中继 API 冒烟测试
node scripts/relay-hash-test.mjs  # 增量 SHA-256 测试
cargo test --manifest-path src-tauri/Cargo.toml
```

## 安全与隐私

- **局域网模式**：HTTP、SSE 均为明文；配对码/token 只是访问控制，不能防止同网段抓包
- **不要暴露 Hub 到公网**：不要把 42080 映射到公网；跨网络请用独立 Relay + HTTPS
- 配对码只在 Hub 内存中保存；`/api/session` 只允许 loopback + 本机 Origin 读取
- `Host`/`Origin` 有白名单，拒绝 null Origin、任意域名和 DNS rebinding；CORS 不使用 `*`
- 配对码 6 位数字，只用于配对；配对成功后签发 256-bit token，12 小时过期；配对失败同时按 IP/全局限流
- 跨网络中继使用 accessToken、downloadToken 和链接 fragment 中的解密 key；接收端校验文件 SHA-256
- 文件只保存在本机 `Downloads/Filebridge-Lan`、用户选择的下载目录或中继密文目录
- 运行时不包含遥测；安装包内嵌 WebView2 bootstrapper，缺失时需联网下载
- 安全问题请按 [SECURITY.md](SECURITY.md) 私下报告

## 已知限制

- 未实现上传断点续传
- 局域网 HTTP 无 TLS；不要用于不可信网络
- 跨网络中继是实验性功能，未完成真实 WAN 验证；默认单文件 2GB、总存储 8GB、TTL 24h
- 中继可见元数据；需要外部 HTTPS/反向代理；当前无正式账号体系
- 跨网络接收端在内存中组装 Blob，超大文件受手机内存限制
- 中继需要自行部署 HTTPS；仓库不提供托管实例
- 安装包未签名，未构建 MSI
- Windows 以外平台未做发布验证

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。提交前请跑 `npm run check`、`npm run test:hub`、`npm run test:bridge` 和 `cargo test`。

## 许可证

本项目使用 [MIT License](LICENSE)。第三方依赖许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 致谢

源码与发布：[8hourseontheleft6/Filebridge-Lan](https://github.com/8hourseontheleft6/Filebridge-Lan)。
