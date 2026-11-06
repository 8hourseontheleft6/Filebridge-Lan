# Filebridge-Lan 1.5.5

发布日期：待 CI Draft 验证后确定

1.5.5 修复 1.5.4 Preview 中发现的运行版本不一致和远端离线反馈滞后问题；不改变 1.5.4 已通过的 Safari Fetch Blob 上传与续传机制。

## 版本一致性

- Rust Hub 的版本改为编译期 `CARGO_PKG_VERSION`，不再维护手写常量。
- Node Hub 和 Node Bridge 从根目录 `package.json` 读取版本。
- `/api/info`、Bridge `/api/health` 和发现广播统一返回当前真实版本。
- CI 新增版本一致性检查，覆盖 `package.json`、Tauri 配置、Cargo 清单、锁文件，以及实际启动的 Node Hub/Bridge 版本接口。

## 远端离线反馈

- 远端文件页每 3 秒刷新；一次临时失败会先做一次短重试，避免单次网络抖动立刻清空界面。
- EventSource 断开时先等待短暂恢复窗口，再标记离线；恢复连接后自动重新探测并刷新文件列表。
- 主机切到 Public 或关闭后，远端会在数秒内显示“主机服务不可用”，不再继续显示绿色在线状态。
- 离线期间保留最后一次文件列表，并标记为“离线缓存，可能已过期”。
- 离线期间禁用选择文件、拖放、开始上传、下载、删除和批量操作；恢复后自动解禁。
- 主机本机继续显示“当前网络为公用网络，服务已暂停”；远端文案为“主机不可达，可能已暂停或离线”，两种状态明确区分。
- 安全门禁不变：关闭主机提示弹窗不能绕过 Public 门禁。

## 验证状态

已通过：

- 真实设备 Public/Private 切换验证：主机立即暂停，42080/42081 停止监听，另一台电脑不能继续上传，关闭弹窗不能绕过门禁。
- `npm run check`
- `npm run build`
- `npm run test:version`
- `npm run test:hub`
- `npm run test:resume`
- `npm run test:offsets`
- `npm run test:bridge`
- `cargo test`
- `cargo check`

仍需最终 CI 安装包复核：

- 两台电脑 Private 发现、连接和主机批准；
- 主机切 Public 后远端 5 秒内显示离线并禁用操作；
- 切回 Private 后无需重启自动恢复；
- 390px / 900px / 1440px 离线提示和禁用状态；
- iPhone Safari、iPhone Edge、Android 的最终上传对照；
- 最终安装器防火墙规则状态。
