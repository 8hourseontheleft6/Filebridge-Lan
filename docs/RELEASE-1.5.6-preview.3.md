# Filebridge-Lan 1.5.6 Preview 3

发布日期：待虚拟机双机验收后确定

这是 `1.5.6` 的第三个 Preview，修复桌面端单实例、端口失败后的自动恢复和设置页旧 Logo 残留；上传、断点续传、局域网发现、主机批准与 Public 门禁逻辑不变。

## 单实例运行

- 增加 Windows 命名互斥量单实例保护；生产版与开发版使用不同互斥量，`tauri dev` 不会被已安装版本阻塞。
- 第二次启动在创建 Tauri 窗口、Hub 和发现线程之前退出，并还原、聚焦已有主窗口。
- 系统中只保留一个主进程，不会出现第二个实例占用 42080/42081 后显示端口错误、页面却仍显示在线的情况。

## 端口占用与自动恢复

- Hub/发现服务改为先绑定 TCP 42080 和 UDP 42081，绑定成功后才记录 `running=true`。
- 端口被占用时状态为 `running=false`，并显示具体是 TCP 还是 UDP 端口被占用。
- 每 5 秒重新检查；端口释放后自动重新绑定并恢复服务，无需重启应用。
- 已运行时不重复创建线程；停止后重新启动会重新绑定两个端口。
- 前端在服务未运行时强制显示离线，不再依赖旧 Hub 的“在线”结果。

## 设置页 Logo

- “关于”区域改用新的白色底板 App Icon，不再使用旧蓝底字母 `F`。
- 删除旧 `.about-mark` 的蓝色渐变、字体和阴影样式。
- 侧栏、接收页、设置页、favicon、Tauri 图标和安装器统一使用同一套 Logo 资源。

## Windows 安装图标

- 重新核对 `src-tauri/icons/icon.ico` 的 16/20/24/32/40/48/64/128/256 九档帧。
- 核查 v1.5.6-preview.2 CI 安装包发现：app exe 内嵌图标已是新 Logo，但 NSIS 安装器仍使用旧蓝色图标；根因是 `bundle.windows.nsis.installerIcon` 未显式配置。
- 本版本将安装器图标显式指向 `icons/icon.ico`，并重新生成安装包。
- `npx tauri icon` 生成的 exe 图标、任务栏/开始菜单图标和 NSIS 安装器图标来自新的白色底板 App Icon。
- 旧版桌面快捷方式或 Windows Explorer 图标缓存可能仍显示旧图标；本版本不直接清理系统图标缓存，安装/升级后会重新核对快捷方式。

## 验证状态

已通过：

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

待虚拟机验收：

- 同一 CI 安装包在主机和桥接 Wi-Fi 虚拟机各安装一次；
- 两端 `/api/info` 均为 `1.5.6-preview.3`；
- 互相发现、连接、主机批准、双向上传/下载和 SHA-256；
- 主机切 Public 后远端约 5 秒内显示不可用，操作禁用；切回 Private 自动恢复；
- 第二次启动只有一个主进程和一个监听者；
- 干净安装后的 exe、桌面/开始菜单快捷方式和安装器图标。
