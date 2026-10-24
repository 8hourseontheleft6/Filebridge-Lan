# FileBridge 1.1.1（热修复）

> 历史版本：本记录使用旧名 FileBridge；当前版本见 [RELEASE-1.2.0.md](RELEASE-1.2.0.md)。

发布日期：2026-10-24

## 修复内容

安装版打开后左侧显示“离线 / 连接失败”、不显示二维码。

**根因**：Tauri 生产页面的 origin 是 `http://tauri.localhost`。前端按当前 hostname 拼接 API/信令地址，得到 `http://tauri.localhost:42080` 和 `ws://tauri.localhost:42070`；这些请求被 Tauri 自定义协议截获并返回 HTML，`response.json()` 失败，页面因此判定 Hub 离线。

**修复**：Tauri 环境固定使用 `http://127.0.0.1:42080` 和 `ws://127.0.0.1:42070`；手机浏览器仍使用电脑局域网 IP。

## 下载

| 项目 | 值 |
|---|---|
| 安装包 | `FileBridge_1.1.1_x64-setup.exe` |
| 大小 | 4.86 MB |
| SHA-256 | `79a440652b1c50029b35e5f0ef25af97a0e8eb892bc8d2a6a76edc331d3c9a99` |
| 平台 | Windows 10/11 x64 |
| 签名 | 未签名（SmartScreen 可能提示“未知发布者”） |

构建产物原始路径：`src-tauri/target/release/bundle/nsis/FileBridge_1.1.1_x64-setup.exe`。
本机已复制到 `release/`（已 gitignore）。

## 升级

直接运行 1.1.1 安装包覆盖安装即可，无需先卸载 1.1.0；identifier 未变（`com.filebridge.desktop`），会原地升级。

## 验证记录

- 从 1.1.0 覆盖安装 1.1.1 成功，安装目录 `%LOCALAPPDATA%\FileBridge` 中 `filebridge.exe` 文件版本为 **1.1.1**
- 安装版页面实际 origin：`http://tauri.localhost/`
- CDP 检查：`qrCards=1`、`qrUrl=http://192.168.1.100:42080/`，状态徽章为“在线”
- 点击“创建房间”：房间码 `786672`，生成 `http://192.168.1.100:42080/?room=786672` 房间二维码，无连接失败
- `/api/info` 返回 `{"name":"FileBridge Hub","version":"1.1.1","port":42080,...}`
- `42070` 与 `42080` 由同一个 `filebridge.exe` 进程监听

## 已知限制（延续 1.1.0）

- 安装包未做代码签名
- 未实现上传断点续传、SSE 实时进度、访问 token/密码
- WebRTC 房间模式仅支持 ≤64KB 小文件；大文件请用 HTTP 直传
- 局域网 HTTP/信令为明文且 Hub 无鉴权，不要暴露到公网
- 本次只产出 NSIS 安装包，未构建 MSI

## 重新构建

```bash
npm install
npm run tauri build
```

产物：`src-tauri/target/release/bundle/nsis/FileBridge_<version>_x64-setup.exe`
