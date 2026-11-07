# Filebridge-Lan 1.5.6

发布日期：2026-11-07

1.5.6 是 `1.5.6-preview.3` 的稳定版收尾。预览版已经完成真实 Windows 主机 + Windows 虚拟机双机验收；本次只收敛版本号和发布文档，不改变已验证的功能逻辑。

## 大文件上传与续传

- iPhone Safari 使用 Fetch + Blob 进行 2MB 分块上传；收到 200/201 响应头后取消不需要的响应体，再通过 `/api/upload/chunk/:id` 查询服务端真实 offset。
- 续传只使用服务端确认的落盘 offset，不把浏览器“已发送”字节当成“已保存”；支持服务端 offset 向前/向后校正。
- 最终文件大小和 SHA-256 与源文件一致；失败后保留 `.part` 以便继续，用户主动取消才清理临时分块。
- iPhone Edge、Android 的 XHR 兼容路径保留；Node Hub 与 Rust Hub 的 offset、409、最终大小、SHA-256、取消和 `.part` 语义保持一致。

## 远端离线与自动恢复

- 远端健康检查带 2 秒硬超时和串行化；连续两次失败才进入离线，避免单次网络抖动误报。
- Rust/Node Hub 每 5 秒发送 SSE `heartbeat`；客户端超过 10 秒没有任何 SSE 事件时主动探测并标记异常。
- 主机切 Public 或停止后，远端在约 5 秒内显示“主机服务不可用”；文件选择、拖放、上传、下载、删除和批量操作被禁用，最后文件列表标记为离线缓存。
- 切回 Private 后自动重新探测、刷新文件列表并解除禁用，无需刷新页面或重启应用。
- 主机本机显示 Public 暂停状态，远端显示主机不可达，二者文案区分。

## 桌面稳定性

- Windows 单实例保护：第二次启动只聚焦并还原已有窗口，不再创建第二个 Tauri 实例、Hub 或发现线程。
- Hub/发现服务先成功绑定 TCP 42080 和 UDP 42081 才记录运行；端口被占用时显示明确原因，释放后自动重试恢复。
- 已运行时不重复创建线程；停止后重新启动会重新绑定两个端口。

## 网络与访问控制

- Public/未知网络下不启动局域网 Hub 和发现服务；关闭提示不能绕过门禁。
- 同一 Private/Domain 局域网可通过附近电脑发现、连接请求和主机显式批准建立会话；批准前不能访问文件。
- 文件上传、下载、Range、SSE 进度和 SHA-256 校验保持原有行为。

## 品牌与图标

- 正式启用新的 Filebridge-Lan 标识：手写 `F` 与局域网信号弧；黑色透明、白色透明和白色底板 App Icon 来自同一矢量母版。
- 16/20/24px 对小尺寸做笔画补偿和信号弧简化；32px 以上恢复完整三段弧。
- favicon、Tauri 图标集、Windows 任务栏/开始菜单、NSIS 安装器和设置页“关于”统一使用白色底板 App Icon。
- NSIS `installerIcon` 已显式配置，修复预览版安装器仍显示旧蓝色图标的问题。
- 旧字母方块 `F` 已退役；品牌字仍为 Cambria，中文正文和功能控件使用 Microsoft YaHei / Inter。

## 验收状态

已通过：

- 真实 Windows 主机 + Windows 虚拟机双机验收：发现、连接、主机批准、双向传输、Public/Private 切换和恢复；
- iPhone Safari 大文件上传与续传；
- `npm run check`
- `npm run build`
- `npm run test:connection`
- `npm run test:version`
- `npm run test:hub`
- `npm run test:resume`
- `npm run test:offsets`
- `npm run test:bridge`
- `cargo test`
- `cargo check`

安装包为未签名 NSIS；Windows SmartScreen 可能提示“未知发布者”。安装器需要 UAC 配置专用网络防火墙规则，不修改 Public 网络或 Defender 设置。
