# Filebridge-Lan 1.5.6 Preview 1

发布日期：待 CI Draft 双机复核后确定

这是 `1.5.6` 的第一个 Preview。v1.5.5 的 Public 门禁通过，但真实双机测试未看到远端自动断联提示，因此 v1.5.5 未发布；本次仅修复远端断联检测和反馈。

## 修复内容

- Hub 健康检查使用 `AbortController` 硬超时（2 秒），避免主机停止后请求无限挂起。
- 健康探测串行化：前一次探测未完成时不会叠加新请求。
- 连续两次失败才进入离线；成功后重置失败计数，避免单次网络抖动误报。
- 远端页面顶部显示 `role="alert"` 的主机不可用提示；保留最后文件列表并标记“离线缓存，可能已过期”。
- 离线时立即禁用文件选择、拖放、待上传队列的“开始上传”、保存/下载、删除和批量操作。
- 恢复 Private 后，下一次成功探测自动恢复在线、刷新文件列表并解除禁用，无需刷新页面。
- Rust Hub 和 Node Hub 每 5 秒发送 `heartbeat` SSE 事件；客户端超过 10 秒没有收到任何 SSE 事件时主动标记异常并触发探测。
- SSE `onerror` 也立即触发探测，不再只等待上传失败暴露问题。
- 主机本机 Public 暂停 UI 与远端“主机不可达”提示保持区分。
- Public 安全门禁、Safari Fetch 上传和断点续传逻辑不变。

## 验收背景

v1.5.5 已用两台真实电脑测试：

- 主机切 Public 后本机立即暂停；
- 42080/42081 停止监听；
- 远端不能继续上传；
- 但远端没有及时显示明确断联提示，只有尝试上传时才暴露 Hub 不可用。

因此 v1.5.5 保持 Draft 并标记废弃。1.5.6 Preview 1 需要在两台真实电脑上重新验证自动断联与恢复。

## 验证状态

已通过：

- `npm run check`
- `npm run build`
- `npm run test:connection`（连接监测状态机 6 项）
- `npm run test:version`
- `npm run test:hub`（含 SSE heartbeat）
- `npm run test:resume`
- `npm run test:offsets`
- `npm run test:bridge`
- `cargo test`
- `cargo check`

仍需最终 CI 安装包真机复核：

- 两台电脑都显示 `1.5.6-preview.1`；
- Private 下发现、批准、上传和下载；
- 主机切 Public 后远端约 5 秒内显示“主机服务不可用”，上传和删除入口禁用；
- 切回 Private 后远端自动恢复、刷新文件列表；
- iPhone Safari 上传和续传不回归；
- iPhone Edge / Android 对照；
- 最终安装器防火墙规则状态。
