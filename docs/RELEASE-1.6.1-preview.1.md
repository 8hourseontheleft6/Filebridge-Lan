# Filebridge-Lan 1.6.1 Preview 1

发布日期：2026-11-15（Draft，未发布）

这是一个 **修复型 Preview**，用于验收发布阻断缺陷的修复。请只验证局域网地址、二维码与手机连接。

## 阻断缺陷与修复

### 现场问题

Windows 同时存在真实 WLAN 与 VirtualBox Host-Only 时，Hub 公布的地址列表把虚拟网卡排在前面：

```json
{ "ips": ["192.168.56.1", "192.168.2.53"] }
```

前端直接取第一项，二维码与手机链接变成 `http://192.168.56.1:42080`（VirtualBox Host-Only），手机无法连接。1.6.0 的构建因此不能发布，其 Draft 已标记「已废弃，请勿发布」。

### 根因

- Rust Hub 的 `local_ips` 仍用 `local_ip_address::list_afinet_netifas()`，只排除了回环，没有使用 1.6.0-preview.5 已修好的真实/虚拟网卡识别；
- `get_info()` 只按 `192.168/10/172` 前缀排序，没有区分默认路由网卡与虚拟网卡；
- 前端 `resolvePhoneBase()` 取 `ips[0]`；
- Node Hub 的 `lanIps()` 直接遍历 `os.networkInterfaces()`，同样未过滤；
- 发现服务的定向广播仍按全部 IPv4 接口生成。

### 修复内容

- **共享判定**：真实/虚拟网卡识别（驱动描述 + 已知虚拟厂商 MAC 前缀 + 名称标记）抽出为可复用函数 `is_usable_lan_interface`，Hub、发现服务与网络合规判定共用同一套规则。
- **Rust Hub 地址来源**：`/api/info.ips` 改为由真实局域网接口生成，不再使用未过滤的接口枚举；`get_info()` 不再自行排序，直接返回已排好序的候选。
- **地址优先级**：默认路由网卡优先（`GetBestInterface`，不发包，仅查路由表）→ Windows `InterfaceMetric` → 地址字符串；虚拟网卡永不进入候选。没有互联网但仍存在真实局域网时，退化为按 InterfaceMetric 排序的真实网卡。
- **Node Hub 一致**：新增 `server/lan-ips.mjs`，按同一策略过滤与排序；默认路由通过 UDP `connect()` 读取本机出口地址获得（不发包）。`/api/info.ips` 与 Rust 使用同一份共享测试夹具。
- **前端兜底**：新增 `listPhoneHosts()` / `pickPhoneHost()`，只接受 Hub 提供的私网候选，跳过回环/链路本地/多播/非法地址；若候选里出现 VirtualBox 默认网段 `192.168.56.0/24`，优先使用其它地址，因此即使旧版 Hub 顺序错误也不会生成错误二维码。
- **多地址可选**：当真实候选多于一个时，界面在二维码下方列出「其它可用地址」，避免静默选错后无法连接。
- **发现服务**：定向广播目标只基于真实局域网接口，不再向 Host-Only 子网广播。

## 验证

修复后本机（WLAN 192.168.2.53 Private + VirtualBox Host-Only 192.168.56.1 Up + TAP + Wi-Fi Direct）实测：

```
advertised_ips default_route=Some(8) ordered=["192.168.2.53"]
Node Hub /api/info: {"ips":["192.168.2.53"], ...}
二维码地址: http://192.168.2.53:42080
```

`192.168.56.1` 不再出现。

### 新增测试

Rust（`cargo test`）：

1. Private WLAN + VirtualBox Host-Only → 只公布 WLAN；
2. 两块 Host-Only + WLAN → 两块都被排除；
3. Host-Only 与 WLAN 同属 `192.168` 前缀且 metric 更低 → 仍不参与排序；
4. Wi-Fi Down、Ethernet Up → 选 Ethernet；
5. Ethernet Down、Wi-Fi Up → 选 Wi-Fi；
6. 两块真实私网卡 → 默认路由网卡优先，且不受字符串排序影响；
7. 只有虚拟网卡 → 候选为空（不生成任何二维码链接）；
8. 共享夹具 `scripts/fixtures/lan-ips.json` 的选择结果与 Node 实现一致；
9. 发现服务广播目标不包含 `192.168.56.255`。

Node（`npm run test:lan`）：同一夹具顺序、虚拟网卡识别、两块 Host-Only、仅虚拟网卡、默认路由优先、链路本地/内部接口排除。

前端（`npm run test:lan`）：`pickPhoneHost` / `listPhoneHosts` / `resolvePhoneBase` —— 错误地址出现在数组前或后都只会得到 `http://192.168.2.53:42080`；候选为空时不生成链接。

## 自动化测试结果

| 命令 | 结果 |
|---|---|
| `npm run check` | 通过 |
| `npm run build` | 通过 |
| `npm run test:version` | `VERSION_OK 1.6.1-preview.1` |
| `npm run test:connection` | 通过 |
| `npm run test:clipboard` | 通过 |
| `npm run test:lan`（新增） | 14 项通过 |
| `npm run test:hub` | `HUB_SMOKE_OK` |
| `npm run test:resume` | `RESUME_SMOKE_OK` |
| `npm run test:offsets` | 通过 |
| `npm run test:bridge` | `BRIDGE_SMOKE_OK` |
| `cargo test` | 通过（含上述 9 项） |
| `cargo check` | 通过 |
| `git diff --check` | 干净 |

## 仍需用户验收

- 在本机（WLAN 192.168.2.53 Private + 以太网 4 VirtualBox Host-Only Up）安装本构建，确认二维码为 `http://192.168.2.53:42080`，手机可扫码连接；
- 若存在第二块真实私网卡，确认「其它可用地址」显示正确且可手动打开；
- 真实双机与 Public/Private 切换未在本构建重新验收。

## 发布状态

- 本版本为 **Draft**，未发布；
- `v1.6.0` tag 与 Draft 保留但**已废弃**（Draft 标题与正文已标注），不会被发布；
- `v1.6.0-preview.1`–`preview.5` 的 tag、Release 与资产均未改动。
