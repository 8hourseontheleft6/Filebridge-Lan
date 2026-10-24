# FileBridge 1.1.3

> 历史版本：本记录使用旧名 FileBridge；当前版本见 [RELEASE-1.2.0.md](RELEASE-1.2.0.md)。

发布日期：2026-10-24

## 新增 / 修复

- **下载进度与取消**：桌面端保存大文件时显示百分比、速度、剩余时间，可随时取消。
- **原子写入**：先写同目录下的 `.part`，完成后原子重命名成目标文件；取消或失败自动删除临时文件，不会留下半截正式文件。
- **电脑端实时接收进度（SSE）**：手机上传时，电脑端通过 `/api/events` 显示“正在接收”、百分比、速度、剩余时间；完成后提示并刷新列表。
- **上传响应稳定性修复**：Hub 在 stdout 不可用（例如后台/无控制台启动）时，上传完成日志的 `println!` 可能 panic，导致 HTTP 响应和 `completed` SSE 事件丢失。现改为“日志失败不影响传输”的安全写法。
- **Tauri 事件权限**：新增 `src-tauri/capabilities/default.json`（`core:default`），确保前端能监听 `download-progress` 事件。

## 下载

| 项目 | 值 |
|---|---|
| 安装包 | `FileBridge_1.1.3_x64-setup.exe` |
| 大小 | 5.0 MB |
| SHA-256 | `b4bc12b8c421067e0f1fb1a9d264bb49d1f9f475721ece1cc47533cea00928c2` |
| 平台 | Windows 10/11 x64 |
| 签名 | 未签名（SmartScreen 可能提示“未知发布者”） |

构建产物原始路径：`src-tauri/target/release/bundle/nsis/FileBridge_1.1.3_x64-setup.exe`。
本机已复制到 `release/`（已 gitignore）。

## 安装 / 升级

直接运行安装包覆盖安装即可，不需要先卸载。默认安装到 `%LOCALAPPDATA%\FileBridge`。

首次启动若出现 Windows 防火墙提示，请允许专用网络（TCP 42070 / 42080）。

## 验证记录

### 下载（512 MB）

- 保存过程中显示 `💾 正在保存 fb-1.1.3-test.bin`，进度 0% → 42% → 57% → 100%，约 1.07 GB/s
- 完成后 Toast：`下载完成：C:\Users\user\Downloads\fb-1.1.3-test.bin`
- 目标文件大小 **536,870,912 bytes**，目录中没有 `.part`
- 再次点击“重新保存”：`文件已存在，未重复保存`，仍只有 1 份
- 取消测试（512 MB，20 ms 后取消）：返回 `已取消`，取消目录为空，没有正式文件或 `.part`

### 上传（512 MB，限速 30 MB/s）

- 电脑端实时显示：41% → 53% → 64% → 76% → 88% → 100%，约 30 MB/s，带剩余时间
- 修复安全日志后，10 MB 完成测试显示 Toast `已接收 sse-complete-check.bin`，进度卡片自动消失，文件列表刷新
- Node Hub 的 `/api/events` 也验证了 `started → progress → completed` 事件

### 自动化

- `npm run test:hub`：11 项通过
- `cargo test`：2/2 通过
- `npm run check`：通过
- `/api/info` 返回 `1.1.3`；42070/42080 由同一进程监听

## 已知限制

- 上传断点续传仍未实现：网络中断/刷新后需要重传。
- SSE 只在页面打开时显示；没有传输历史。
- 正常取消/失败会清理 `.part`；如果进程被强制结束，目标目录可能留下隐藏的 `.part`，但不会覆盖正式文件。
- 下载进度是本地复制速度；U 盘/网络盘会明显更慢。
- 安装包未做代码签名；未构建 MSI。
- 局域网 HTTP/信令为明文且 Hub 无鉴权，不要暴露到公网。

## 重新构建

```bash
npm install
npm run tauri build
```

产物：`src-tauri/target/release/bundle/nsis/FileBridge_<version>_x64-setup.exe`
