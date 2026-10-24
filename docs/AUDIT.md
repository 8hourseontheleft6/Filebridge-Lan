# Filebridge-Lan 现状审计

> 历史审计：2026-10-23（项目名 FileBridge 时期）。部分问题已在 1.1.x/1.2.0 修复，本文件保留用于追溯。

> 审计时间：2026-10-23
> 代码基线：`d4943e1`（分支 `master`，无远端）
> 工作区状态：交接前已有 `src/App.tsx`、`package-lock.json` 改动；本次新增 `docs/AUDIT.md`、`docs/ROADMAP.md`，并调整 README 与 `.gitignore`
> 审计方式：全量阅读源码/文档 + `tsc --noEmit` + 生产构建 + 信令服务器双端冒烟测试
>
> 注：本文记录 2026-10-23 交接时的状态；部分 P0 已在后续提交修复，进展见 [ROADMAP.md](./ROADMAP.md) 的"进展快照"。

## 0. 结论先行

1. **这是一个能跑通"小文件演示"的原型，不是 README 里描述的 v1.0.0 产品。** 文档描述了 v2 级能力（PWA、mDNS/UDP 发现、ECDH+AES、SHA-256、断点续传、传输队列），但其中约 1,000 行核心模块从未被 `App.tsx` 引用，Tauri 的 Rust 命令全部是 `println!` 占位。
2. **当前最大的问题不是"功能少"，而是"会静默丢数据"。** 手机通过 `http://局域网IP` 访问时没有 secure context：`showSaveFilePicker` 不存在，StreamSaver 依赖外网 CDN，失败后代码仍继续接收并回 ACK，发送端显示"发送成功"，接收端文件是空的。
3. **最近 5 个 commit 都在同一个坑里打转**（localStorage → IndexedDB → StreamSaver → 调缓冲区阈值）。这说明问题出在"浏览器在非安全上下文里无法可靠地把大文件流式落盘"这一结构性约束上，继续打补丁不会收敛，需要一次传输层的架构决策。
4. **仓库本身也不健康**：`.git` 313 MB + 遗留的 `.git_disabled` 317 MB，合计约 **630 MB**，其中 331 MB 来自第一次提交误纳入的 git pack 文件。

## 1. 实测基线

| 项目 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 error |
| `npm run build` | ✅ 成功，31 modules，JS 213.51 kB（gzip 67.10 kB），CSS 2.49 kB |
| 信令服务器冒烟测试 | ✅ 7/7：建房、加入、offer、answer、双向 ICE、host 断开通知 |
| Node / npm | v24.21.0 / 11.19.0 |
| Rust / Cargo | 1.94.1 / 1.94.1；`cargo check` 通过（1 个 unused import 警告） |
| 运行中的服务 | 无（5173 / 42070 均未监听） |
| 测试 / Lint / CI | ❌ 均不存在 |

> 冒烟测试方法：启动 `server/signaling.ts`，用两个 `ws` 客户端走完 `create_room → join_room → offer → answer → ice_candidate ×2 → host_disconnected`。信令层本身是可用的，问题主要在客户端和文件落盘链路。

## 2. 实际文件结构

```
Filebridge-Lan/                        31 个受版本控制文件
├── src/
│   ├── App.tsx                    687 行，上帝组件：UI + 分帧 + 哈希 + 接收落盘 + IndexedDB
│   ├── transfer/
│   │   ├── webrtc.ts              340 行，信令 + PeerConnection + DataChannel + 背压
│   │   └── protocol.ts            401 行，类型/分块/哈希/TransferQueue（约 2/3 未被使用）
│   ├── crypto/auth.ts             504 行，PIN/ECDH/AES/信任存储（完全未被引用）
│   ├── network/discovery.ts       373 行，mDNS/UDP/WS 发现（完全未被引用）
│   ├── main.tsx / global.d.ts / index.css
├── server/
│   ├── signaling.ts               134 行，WebSocket 信令，实测可用
│   └── start.js                   同时拉起信令 + Vite
├── src-tauri/
│   ├── src/lib.rs                 38 行，3 个 command 全是占位实现
│   └── tauri.conf.json            csp: null，无 capabilities 目录
├── docs/ARCHITECTURE.md           158 行，描述的是"目标架构"而非现状
├── dist/                          本地构建产物（已 gitignore）
├── .git/                          313 MB
├── .git_disabled/                 317 MB，已被 gitignore 的遗留副本
└── start.bat / README.md / package.json / vite.config.ts / tsconfig.json
```

**没有 `public/` 目录**，但 `index.html` 引用了 `/manifest.json` 和 `/favicon.svg`，两者都会 404；也没有任何 Service Worker 注册代码。README 的 "PWA（Service Worker）" 不成立。

## 3. 当前真实数据流

```
电脑浏览器/ Tauri WebView                      手机浏览器
        │                                          │
        │  ① 页面（Vite :5173）                     │
        ├──────────── ws://<host>:42070 ───────────┤  ② 信令：建房/加入/offer/answer/ICE
        │                                          │
        │  ③ WebRTC DataChannel（局域网直连）       │
        ├──────────────────────────────────────────┤
        │  帧格式：[uint32 metaLen][JSON meta][payload]
        │                                          │
        │  ④ 接收：StreamSaver / showSaveFilePicker / 内存 Blob
        │     ↑ 这里就是所有大文件问题的所在
        │                                          │
        │  ⑤ ACK：接收端写入后立即回 chunk_ack
        │     发送端只记录，不等待、不重传、不校验
```

桌面端并不是一个自包含的应用：Tauri 不启动信令服务器，也不实现 UDP/mDNS，必须靠 `start.bat` 或手动 `npx tsx` 拉起 Node 进程。脱离 Node 和 Vite，桌面壳没有可用后端。

## 4. 缺陷清单

### 4.1 P0：数据正确性 / 功能不可用

**D1｜手机端大文件接收没有可靠的落盘路径，且失败后静默丢数据**
- 位置：`src/App.tsx:200-234`、`index.html:11`
- 链路：手机以 `http://<LAN-IP>:5173` 访问 → 非 secure context → `showSaveFilePicker` 不存在 → 走 StreamSaver；而 StreamSaver 从 `https://unpkg.com` 加载，离线局域网/被墙/被拦截时 `window.StreamSaver` 为 `undefined` → `createWriteStream` 抛错被 catch → 代码**继续**登记接收任务。
- 即使 CDN 可用，现有代码仍有 **三处 StreamSaver API 误用**：UMD 全局名是 `window.streamSaver`（小写 s），代码查的是 `window.StreamSaver`；`createWriteStream()` 返回 `WritableStream`，必须 `getWriter()` 才能 `write()`，代码直接调用 `stream.write()`；它只接受 `Uint8Array`，代码传的是 `ArrayBuffer`。三处任意一处都会让每个 chunk 的写入抛错，而错误只进了 `console.error`，ACK 继续。
- 后果：后续 chunk 既没有 writer，也不进 `incoming.chunks`（一直是 `[]`），但 `sendChunkAck()` 照常发送（`:266`）；发送端认为成功，接收端最终下载到 0 字节文件。即使 StreamSaver 可用，UI 仍会在完成后显示"下载"按钮，而 `incoming.chunks` 为空，点下去还是空文件（`:655-662`）。
- 这正是 2026-06-30 那 5 个 commit 反复修的地方，但每次只换了"往哪里写"，没有解决"写不进去时怎么办"。

**D2｜用户取消保存后仍继续收数据并 ACK**
- 位置：`src/App.tsx:219-222`
- `showSaveFilePicker` 被取消时直接 `return`，没有通知发送端、没有清理 `receivedProgress`；发送端继续发，接收端没有 writer 也没有缓存，全部丢弃，且仍回 ACK。属于静默数据丢失。

**D3｜0 字节文件会卡死**
- 位置：`src/App.tsx:173-195`
- 判断条件 `fileData.byteLength > 0` 把空文件误判为"大文件"，进入 `file_meta` 无数据的接收分支，等待永远不会到来的 chunk。

**D4｜完整性校验名存实亡**
- 发送端：小文件 `computeHash`（`:407`），大文件 `computeFileHash`（`:430`），哈希写进 meta。
- 接收端：`handleData` 从头到尾没有比较过 `meta.hash`，也没有在完成后重算。
- 在 `http://` 下 `crypto.subtle` 不可用，`computeHash` 会降级为 **32 位 FNV-1a**（`src/transfer/protocol.ts:325-349`），不是文档声称的 SHA-256；32 位哈希用于完整性校验存在碰撞风险。
- `computeFileHash` 对 >100 MB 文件会整文件读一遍再发一遍，I/O 翻倍、CPU 翻倍，结果却没人用（`src/transfer/protocol.ts:354-376`）。

**D5｜ACK 语义不成立**
- 接收端在 `writer.write()` 调用后立刻 ACK（`:266`），不等待落盘成功；无 writer 时也 ACK。
- 发送端收到 ACK 只做两件事：打日志、往 `ackedChunks` 里塞索引（`:329-332`），既不等待 ACK，也不重传，更不校验。
- 因此"分块 ACK + 重试"只是日志层面的装饰，不是可靠传输。

### 4.2 P1：连接稳定性 / 体验

**D6｜ICE candidate 早到会被丢弃**
- `src/transfer/webrtc.ts:331-339`：`addIceCandidate` 失败时直接吞掉。candidate 可能在 `setRemoteDescription` 之前到达，部分网络下会连接失败。应缓存并在 remoteDescription 就绪后 flush。

**D7｜信令消息监听器泄漏 / 重复**
- `createRoom` / `joinRoom` 各自 `addEventListener('message', handler)` 且从不移除（`webrtc.ts:58-68`、`:82-91`）；同时 `connectSignaling` 又设置了 `onmessage`（`:189`）。重连、失败重试、重复建房都会叠加监听器。

**D8｜对端断开不更新 UI**
- `App.tsx` 构造 `WebRTCManager` 时没有传 `onPeerLeft`；服务器发了 `peer_disconnected`，界面仍显示"✅ 已连接"。也没有任何重连逻辑。

**D9｜背压实现粗糙，队列无上限**
- `waitForBuffer`（`webrtc.ts:162-172`）从未设置 `bufferedAmountLowThreshold`（默认 0），`bufferedamountlow` 基本不触发，实际退化成每 100 ms 轮询；`sendData` 在 DC 未 open 时静默入队（`:123-136`），`pendingQueue` 无上限，连接失败会一直堆内存。

**D10｜手机端仍是两栏布局**
- `App.tsx:599` 的内联 `gridTemplateColumns: '1fr 1fr'` 优先级高于 `index.css:212-215` 的媒体查询，手机上两个面板被挤成窄条。

**D11｜PWA 资产缺失**
- 无 `public/`，`/manifest.json`、`/favicon.svg` 均 404；无 Service Worker；"PWA 离线能力"不存在。

**D12｜关键路径依赖外网 CDN**
- `index.html:11` 从 unpkg 加载 StreamSaver。局域网离线场景（本产品的核心场景）直接失效；`tauri.conf.json:23` 的 `csp: null` 也让远程脚本没有任何约束。

**D13｜接收端缺少防御**
- 帧头 `metaLen` 无上限校验，`JSON.parse` 抛错没有 try/catch，恶意/错位数据会让异步 handler 产生未捕获异常（`App.tsx:165-171`）。
- 对端文件名直接用于保存建议名，没有路径分隔符/Windows 保留名处理；同名文件无冲突策略；无磁盘空间检查。

### 4.3 P2：工程 / 仓库 / 可维护性

**D14｜仓库 630 MB**
- `.git` 313.3 MB，`.git_disabled` 316.6 MB；最大对象是 331,525,065 字节的 blob `df5dd0c`，来自第一次提交 `ac7632d` 误纳入的 `.git_disabled/objects/pack/*.pack`。第二次提交只是把它从工作树删除，对象仍被历史引用。
- 无远端，只有 7 个 commit，重写历史的成本很低。

**D15｜约 1,000 行死代码，且 IndexedDB 兜底是假的**
- `src/crypto/auth.ts`（504 行）、`src/network/discovery.ts`（373 行）、`src/transfer/protocol.ts` 中的 `TransferQueue`/`createChunks`/`readChunk`（约 200 行）全部未被引用。它们让代码看起来比实际完整得多，也增加了误判。
- `src/App.tsx` 里的 `saveChunk()` / `loadChunk()`（`:27-58`）定义了但**从未被调用**；只有 `loadAndMergeChunks()` 在完成时被调用（`:297`），所以这条 IndexedDB 兜底永远读不到数据。

**D16｜Tauri 后端是空壳**
- `src-tauri/src/lib.rs:5-25` 三个 command 都只 `println!`；没有内嵌 HTTP/WS 服务、没有 UDP/mDNS、没有文件写入命令、没有 capabilities。桌面端离开 `start.bat` 无法工作。

**D17｜文档与实现系统性不一致**
- `docs/ARCHITECTURE.md` 写的是 `core/lib.rs`（实际是 `src-tauri/src/lib.rs`）、`ui/`（不存在）、PWA、mDNS、ECDH+AES、断点续传；README 的技术栈表同样声称 PWA / mDNS / ECDH+AES，功能清单则把断点续传/文件夹/剪贴板/跨网络列为未完成，容易让人误以为其余能力已经就绪。
- 文档目前是"愿望清单"，不能作为交接依据。

**D18｜依赖与版本**
- `react-router-dom` 未被使用；`esbuild` 作为直接依赖但只被 Vite 间接使用。
- `package.json` 1.0.0、`tauri.conf.json` 0.1.0、`discovery.ts` 里的 `version: '0.1.0'` 三处不一致。
- `tsconfig` 的 `strict: true` 是好事，但 `noUnusedLocals: false` 让死代码没有被暴露。

**D19｜零测试、零 Lint、零 CI**
- 没有 `vitest`/`playwright`/`eslint`/`prettier`；唯一的门禁是 `tsc`。所有回归靠手动拿手机试，这正是 commit 信息里出现"fix → fix → fix"的原因。

**D20｜启动与安全细节**
- `start.bat` 依赖 `npx` 和 Node，开两个黑窗口；`npm run tauri dev` 不会启动信令服务器；端口 42070 硬编码且无冲突处理。
- 信令服务器无鉴权、无 Origin 校验、无心跳/房间过期/限流；房间码用 `Math.random()` 生成且不查重（`server/signaling.ts:22-24`）；`ws.send` 前不检查 `readyState`（`:59`、`:125`）。

## 4.4 专项：大文件接收为什么会"卡住"

"卡住"至少对应 6 条独立故障链；任何一条都足以让进度停在 99%，且没有超时、没有错误提示、没有缺块重传。

### 链路 A：丢一个块 → 永远等不齐（最可能）

- 发送端 `sendData()` 把 `dc.send()` 的异常 catch 掉，只打 console（`webrtc.ts:123-136`）；`sendDataWait()` 调用它之后立即返回（`:151-159`），发送循环继续，UI 照样把 `offset` 记成"已发送"。
- 256 KB 数据 + JSON 元数据 + 4 字节头刚好贴着 DataChannel 单条消息上限（可在 `pc.sctp.maxMessageSize` 查看）；超限时 `send()` 抛错，正好被吞掉。
- 通道在发送途中关闭时，`sendData` 发现 DC 不是 open 就把数据塞进 `pendingQueue`（`:132-135`）；队列只在下一次 `open` 时 flush，通道不再 open，这块就永远不发。
- 接收端完成条件是 `receivedCount >= total && receivedBytes >= size`（`App.tsx:279`），少一块就永远不成立；没有 NACK、没有超时、没有"缺块列表"，所以界面停在 99.x% 不会报错。

### 链路 B：通道关闭 → 发送端 await 一个不会发生的 open

- `waitForChannel()` 在 `dc` 存在但 `readyState` 为 `closing/closed` 时，会 `addEventListener('open', ...)` 一直等（`webrtc.ts:95-120`）；没有超时。
- 发送循环 `await sendDataWait(packet)` 卡在这里，进度停住；接收端也再收不到数据。

### 链路 C：落盘 writer 失败 → 仍然 ACK → 假成功

- 桌面端 256 KB–100 MB 走 `showSaveFilePicker`（`App.tsx:214`）。它要求 transient user activation，而这里是在 DataChannel 回调里调用，不是用户手势；Chrome 会抛 `SecurityError`，被 catch 成"用户取消保存"然后 `return`（`:219-222`）。
- 即使 picker 成功，`await` 期间到达的 chunk 也会因为 `incomingRef` 还没建立而被 ACK 后丢弃（`incomingRef.set` 在 picker 之后，`:225`）；这是另一个竞态。
- 手机端没有 `showSaveFilePicker` → 走 StreamSaver（`:200-210`）；StreamSaver 从 unpkg 加载，离线/被拦截时全局不存在，`createWriteStream` 抛错被 catch，代码继续。即使加载成功，`window.StreamSaver` 大小写错误、缺少 `getWriter()`、传 `ArrayBuffer` 三处 API 误用会让每个 chunk 写入抛错；错误被 `console.error` 吞掉，ACK 继续。
- 上述两种情况下，`incomingRef` 可能没建立；chunk 到达后没有 writer、也没有缓存，但 `sendChunkAck()` 照发（`:266`），发送端认为成功。
- IndexedDB 兜底是死的：`saveChunk()`/`loadChunk()` 定义了但从未被调用（`:27-58`），所以 `loadAndMergeChunks()`（`:297`）永远读不到数据。

### 链路 D：主线程被日志和状态更新拖死

- 每收到一个 chunk，`handleData` 打 3 条日志（`App.tsx:164/167/170`），再 `setReceivedFiles` 一次；发送端每个 chunk 也打一条"发送分块"（工作区未提交改动，`:475`）。
- 此外 `sendDataWait` / `sendData` 每块还有 3 条 `console.log`（`webrtc.ts:125/128/152/154`），DevTools 打开时会进一步拖慢发送端。
- 2 GB / 256 KB = 8,192 块 → 接收端约 3.3 万次 `setState`、发送端 8,192 次；每次都会 render 日志面板和文件列表。手机主线程被打满，DataChannel 消费变慢，`bufferedAmount` 持续高于 8 MB，发送端进入 100 ms 轮询（`webrtc.ts:162-172`），看起来就是"卡住"。

### 链路 E：还没开始就卡住

- 发送 >256 KB 的文件前会调用 `computeFileHash`（`App.tsx:430`）；>100 MB 时逐 1 MB 读完整文件（`protocol.ts:354-376`），没有进度、没有取消，2 GB 可能要几十秒到几分钟，UI 停在"计算文件哈希..."。
- 16–100 MB 时直接 `file.arrayBuffer()` 把整个文件读进内存；手机上接近 100 MB 的分配可能直接触发 OOM/页面重载。
- 这个哈希还是"每 1 MB 的哈希拼接后再哈希"，不是标准文件 SHA-256，而且接收端从不校验，纯属浪费。

### 链路 F：手机锁屏/切后台

- 浏览器挂起页面后，JS 停止消费 DataChannel；发送端缓冲区满，传输停住。没有 Wake Lock（HTTP 下不可用），也没有"请保持前台"的提示或失败检测。

### 快速定位（按顺序）

1. 发送端 DevTools 搜 `sendData error` / `OperationError`；有就是链路 A。
2. 打印 `dc.readyState`、`dc.bufferedAmount`、`pc.sctp?.maxMessageSize`；readyState 是 closing/closed 且进度不动 → 链路 B。
3. 接收端打印 `receivedCount`、`receivedBytes`、`incoming.size`、`meta.total`，以及缺哪个 index；差一块 → 链路 A。
4. 接收端看 `streamWriters` / `fileWriters` 是否有当前 id；没有 → 链路 C。
5. 看日志是否在疯狂滚动；是 → 链路 D。
6. 看是否停在"计算文件哈希..." → 链路 E；锁屏后停 → 链路 F。

### 最小止血（不改架构）

- `sendData` 出错时向上抛，`sendDataWait` 拒绝，发送循环 catch 后把该文件标记 failed，而不是继续。
- `waitForChannel` 加 10 s 超时；`dc.onclose` 时 reject 所有等待并终止传输。
- 完成条件加超时（如 30 s 无新块 → failed），并把缺失的 index 打出来。
- 删掉每块日志/每块 `setState`，改成 200 ms 节流；日志按"每 100 块"或仅状态变化。
- 接收端在用户点击"接收"后再让发送端开始（解决 FSA user activation），或者对所有 >256 KB 文件统一走 StreamSaver/HTTP。
- 修 `saveChunk` 兜底或直接删掉兜底并显式报错；不要假装成功。
- 大文件传输前不要全量算哈希；要么边传边算，要么先不算。
- `waitForBuffer` 设置 `dc.bufferedAmountLowThreshold = 4MB`，并加超时。

> 这些只能止血。要在手机上稳定传 2 GB，仍然建议走 [ROADMAP.md](./ROADMAP.md) 的 HTTP 流式方案。

## 5. 根因分析

### 5.1 为什么会变成这样

- **文档先行**：第一次提交就写下了完整的 v2 架构文档，但代码只实现了最短路径。后续维护者（Cline）按文档补功能时，优先写了自包含的模块（auth/discovery/queue），却没有把它们接进 `App.tsx`，于是形成"文档很完整、代码在演示"的落差。
- **核心约束没有被正视**：手机以普通 HTTP 访问时，`crypto.subtle`、`showSaveFilePicker`、Service Worker 都不可用。WebRTC DataChannel 在主流 Chromium 上可以在 HTTP 下工作，但"把收到的字节流式写到手机磁盘"这件事在非安全上下文里没有标准、可靠的浏览器 API。5 个 commit 分别尝试 localStorage、IndexedDB、StreamSaver、调阈值，都是在绕这个约束。
- **`App.tsx` 成为集成层**：UI、分帧、哈希、接收落盘、IndexedDB、StreamSaver 全在一个 687 行组件里。每修一个移动端问题，都要改这个文件，耦合持续上升。
- **没有自动化验收**：没有双端 E2E，也没有分块/帧协议的单元测试，只能靠"手机上试一下"，于是修复靠猜。

### 5.2 三个结构性问题

1. **传输层与落盘层没有分离**：发送/接收协议应该只产出"字节流 + 元数据"，落盘策略应该是可替换的（桌面 Rust 写盘、手机浏览器 HTTP 下载、内存 Blob 仅用于小文件）。
2. **桌面端不是自包含的**：产品形态是 Tauri 应用，但服务端是一个需要手动启动的 Node 脚本。要么把 hub 内嵌进 Rust，要么明确放弃 Tauri、只做浏览器工具。
3. **"P2P" 被当成了目标而不是手段**：局域网内 WebRTC 直连并不比本机 HTTP 更快；它真正的价值在跨网络 NAT 穿透。当前把复杂度花在了不需要 NAT 穿透的局域网上。

## 6. 可保留的资产

| 资产 | 评价 | 处理建议 |
|---|---|---|
| `server/signaling.ts` | 实测 7/7 通过，逻辑清晰 | 保留为"可选 WebRTC 模式"的信令；补心跳/过期/查重 |
| 长度前缀 + JSON meta + 二进制的帧思路 | 简单、可调试 | 演进为带 magic/version/type/seq/CRC 的 v2 帧 |
| React UI 骨架 + 暗色 CSS | 可用，信息层级清楚 | 保留视觉，拆组件；修移动端布局 |
| Tauri 壳 + Rust 工具链 | `cargo check` 通过，壳可编译；但业务命令全是占位 | 作为正式桌面形态，内嵌 hub |
| `docs/ARCHITECTURE.md` 的协议意图 | 作为 v2 协议的需求来源 | 重写为 as-built + 目标架构两份 |
| `auth.ts` | 实现质量尚可但未接线 | 冷冻；安全模型重新设计后再决定复用 |

## 7. 审计结论

- **可以继续做，而且值得做**：核心场景（同一 WiFi 下 PC ↔ 手机互传大文件）真实、刚需，信令层和 UI 骨架都可复用。
- **但不能在现有传输链路上继续打补丁**：D1/D2/D4/D5 是同一个结构性问题的四个症状，必须先把"字节如何可靠落盘、如何确认、如何恢复"重新设计。
- **建议的下一步不是加功能，而是做一次传输层收敛**：先做 1 天技术验证（手机浏览器 → 本机 HTTP 端点，2 GB 文件，常量内存），再决定是"桌面 Hub + HTTP 流式"还是"HTTPS + 保留 WebRTC"。具体路线见 [ROADMAP.md](./ROADMAP.md)。
