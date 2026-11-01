# Filebridge-Lan 1.5.4

发布日期：待 CI Draft 验证后确定

1.5.4 是一次以**长时间传输可靠性**和**本地工作台界面**为主的更新。Safari 大文件上传已经过真实 iPhone Safari 验证；正式发布前仍要求用 CI 构建的同一份安装包完成最终真机复核。

## Safari / iOS 上传

- iPhone Safari 默认使用 Fetch + Blob 进行 2MB 分块上传；iPhone Edge、Android 和桌面继续使用兼容的 XHR 路径。
- 修复 iOS WebKit 收到 200 响应头后卡在响应体的问题：现在收到响应头后立即取消不需要的响应体，再通过 `/api/upload/chunk/:id` 查询服务端真实 offset。
- 续传只使用服务端确认的落盘 offset，不把浏览器“已发送”字节当成“已保存”。
- 服务端 offset 支持向前和向后校正；失败后的“继续上传”会先查询服务端，再决定从哪里继续。
- 批量上传保留队列，当前文件失败后可以从正确 offset 继续，不重新上传已完成文件。
- 真实 iPhone Safari 已验证上传 317.64MB ZIP 可以持续完成；400MB 级别和 iPhone Edge/Android 的最终 CI 安装包仍需复核。

## 上传诊断与速率

- 上传进度卡新增默认折叠的“上传诊断”，显示浏览器已发送、服务端请求已读取、服务端落盘、客户端确认 offset、请求头、请求状态和耗时。
- 诊断 JSON 不包含 token、cookie、配对码或用户目录。
- 上传诊断支持 XHR Blob / Fetch Blob 对照切换。
- 电脑端速率卡不再被本机 0 速率覆盖；手机上传时电脑端也能显示接收速率。

## Local Workbench 界面

- 桌面首页改为 Local Workbench 方向：固定侧栏、工作区页面、任务优先的文件列表与传输进度。
- Cambria 用于品牌和重点标题；中文正文、控件、状态和文件列表使用 Microsoft YaHei；英文功能文本使用实际加载的 Inter。
- 统一侧栏、卡片层级、图标、连接状态、进度区、空状态、等待、失败和禁用态。
- 设置从弹窗改为工作区页面；使用说明改为可关闭对话框。
- 上传诊断默认折叠。
- 390px 手机和 900–1440px 桌面重新排版；无横向滚动，隐藏滚动条，保留回到顶部按钮。
- Safari 文件/照片支持连续选择；一次只能选一张时可以累积到待上传队列。

## 安全与门禁

- 不改变 Public/未知网络门禁：不启动局域网 Hub，不允许通过关闭提示绕过。
- 不修改安装器防火墙脚本、Defender 或系统排除项。
- 不改变路径清洗、大小限制、SHA-256 和原子 rename 保护。
- 网络失败保留 `.part` 以支持续传；用户主动取消才清理临时分块。

## 验证状态

已通过：

- `npm run check`
- `npm run build`
- `npm run test:hub`
- `npm run test:resume`
- `npm run test:offsets`
- `npm run test:bridge`
- `cargo test`
- `cargo check`
- 真实 iPhone Safari 大文件上传（317.64MB ZIP，SHA-256 校验）

仍需用 CI Draft 安装包人工复核：

- iPhone Safari 400MB 文件上传与 SHA-256；
- iPhone Edge XHR 路径；
- Android XHR 路径；
- Node Hub / Rust Hub 对照；
- 断网后续传、批量进度、电脑端速率；
- Public/Private 门禁、附近电脑发现和主机批准；
- 1440px / 900px 桌面、390px 手机最终安装包界面。

在以上项目全部通过前，1.5.4 保持 Draft，不正式发布。
