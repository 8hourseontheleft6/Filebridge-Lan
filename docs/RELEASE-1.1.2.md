# FileBridge 1.1.2

> 历史版本：本记录使用旧名 FileBridge；当前版本见 [RELEASE-1.2.0.md](RELEASE-1.2.0.md)。

发布日期：2026-10-24

## 新增

- **桌面端下载反馈**：点击“保存”后显示 Toast——成功时给出完整保存路径，失败时显示原因；可直接“打开”所在文件夹。
- **下载目录设置**：首页 **⚙ 设置** 可修改电脑端下载目录，支持“选择文件夹 / 恢复默认 / 打开文件夹”，设置持久化到 `Downloads\FileBridge\settings.json`。
- **防重复下载**：保存中按钮禁用；目标目录已有同名且大小相同的文件时提示“文件已存在，未重复保存”，不会再生成 `(1)(2)...` 副本。
- 文件名不再作为隐式下载链接，只有明确的“保存”按钮会触发复制。

## 下载

| 项目 | 值 |
|---|---|
| 安装包 | `FileBridge_1.1.2_x64-setup.exe` |
| 大小 | 4.9 MB |
| SHA-256 | `de02cf6dc2d069d329a53e46b8a62dd0f34161f21220537f98c0e0335fc62951` |
| 平台 | Windows 10/11 x64 |
| 签名 | 未签名（SmartScreen 可能提示“未知发布者”） |

构建产物原始路径：`src-tauri/target/release/bundle/nsis/FileBridge_1.1.2_x64-setup.exe`。
本机已复制到 `release/`（已 gitignore）。

## 安装 / 升级

直接运行安装包覆盖安装即可，不需要先卸载。默认安装到 `%LOCALAPPDATA%\FileBridge`。

首次启动若出现 Windows 防火墙提示，请允许专用网络（TCP 42070 / 42080）。

## 验证记录

- 1.1.2 覆盖安装 1.1.1 成功，`filebridge.exe` 文件版本 **1.1.2**
- 设置面板读取到默认路径 `C:\Users\user\Downloads`
- 上传测试文件后点击“保存”：Toast 显示“下载完成：C:\Users\user\Downloads\download-test-1.1.2.txt”，文件存在
- 再次点击“重新保存”：Toast 显示“文件已存在，未重复保存”，`Downloads` 中仍只有 1 份
- 通过设置把下载目录改为 `C:\Users\user\Downloads\FileBridgeTest`，第二个测试文件成功写入该目录；随后恢复默认路径
- `/api/info` 返回 `{"name":"FileBridge Hub","version":"1.1.2","port":42080,...}`
- 42070 / 42080 由同一个 `filebridge.exe` 进程监听

## 已知限制

- 保存过程只显示“保存中…”；复制完成后才弹成功提示，暂无实时复制进度
- 自定义下载目录仅桌面版支持；手机/普通浏览器仍使用浏览器默认下载目录
- 安装包未做代码签名
- 未实现上传断点续传、SSE 实时进度、访问 token/密码
- WebRTC 房间模式仅支持 ≤64KB 小文件；大文件请用 HTTP 直传
- 局域网 HTTP/信令为明文且 Hub 无鉴权，不要暴露到公网

## 旧版本产生的重复文件

1.1.0/1.1.1 的重复下载文件不会被自动删除；确认不需要后可在 `Downloads` 中手动清理。1.1.2 起不会再重复保存同名同大小文件。

## 重新构建

```bash
npm install
npm run tauri build
```

产物：`src-tauri/target/release/bundle/nsis/FileBridge_<version>_x64-setup.exe`
