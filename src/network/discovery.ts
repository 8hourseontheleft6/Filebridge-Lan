/**
 * Filebridge-Lan - 网络发现模块
 * 
 * 设备发现方式：
 * 1. mDNS（多播DNS）- 跨平台服务发现
 * 2. UDP广播 - 局域网对等发现
 * 3. WebSocket信令 - 用于PWA客户端
 * 
 * 协议：JSON over UDP/WebSocket
 */

// ---- 类型定义 ----

export enum DeviceType {
  DESKTOP = 'desktop',
  MOBILE = 'mobile',
  SERVER = 'server',
}

export enum TransportCapability {
  WEBSOCKET = 'ws',
  WEBRTC = 'webrtc',
  HTTP = 'http',
}

export interface DeviceInfo {
  id: string;           // 唯一设备指纹
  name: string;         // 可读设备名称
  type: DeviceType;
  ip: string;
  port: number;
  capabilities: TransportCapability[];
  os: string;           // 'win32' | 'darwin' | 'linux' | 'android' | 'ios'
  version: string;      // Filebridge-Lan版本号
  lastSeen: number;     // 最后在线时间戳
}

export interface DiscoveryMessage {
  type: 'announce' | 'query' | 'response' | 'bye';
  device: DeviceInfo;
  timestamp: number;
}

// ---- 设备指纹 ----

export function generateDeviceId(): string {
  const nav = navigator as any;
  // 使用可用的硬件特征生成指纹
  const components = [
    navigator.platform,
    navigator.hardwareConcurrency,
    navigator.language,
    screen.width,
    screen.height,
    nav.deviceMemory || '',
  ];
  const raw = components.join('|');
  return hashString(raw);
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // 转为32位整数
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// ---- mDNS实现 ----

const MDNS_MULTICAST_ADDR = '224.0.0.251';
const MDNS_PORT = 5353;
const DISCOVERY_PORT = 42069;
const ANNOUNCE_INTERVAL_MS = 5000;
const PEER_TIMEOUT_MS = 15000;

export class NetworkDiscovery {
  private deviceId: string;
  private deviceInfo: DeviceInfo;
  private peers: Map<string, DeviceInfo> = new Map();
  private udpSocket: any = null; // WebSocket或UDP模拟
  private announceTimer: number | null = null;
  private cleanupTimer: number | null = null;
  private onPeerJoin: ((device: DeviceInfo) => void) | null = null;
  private onPeerLeave: ((deviceId: string) => void) | null = null;
  private signalServerUrl: string = '';

  constructor(deviceName: string, deviceType: DeviceType) {
    this.deviceId = generateDeviceId();
    this.deviceInfo = {
      id: this.deviceId,
      name: deviceName,
      type: deviceType,
      ip: '0.0.0.0', // 运行时解析
      port: DISCOVERY_PORT,
      capabilities: [TransportCapability.WEBSOCKET, TransportCapability.WEBRTC],
      os: detectOS(),
      version: '0.1.0',
      lastSeen: Date.now(),
    };
  }

  // ---- 公开API ----

  setSignalServer(url: string) {
    this.signalServerUrl = url;
  }

  onPeerConnected(cb: (device: DeviceInfo) => void) {
    this.onPeerJoin = cb;
  }

  onPeerDisconnected(cb: (deviceId: string) => void) {
    this.onPeerLeave = cb;
  }

  getPeers(): DeviceInfo[] {
    return Array.from(this.peers.values());
  }

  getDeviceId(): string {
    return this.deviceId;
  }

  getDeviceInfo(): DeviceInfo {
    return { ...this.deviceInfo };
  }

  async start() {
    // 1. 启动UDP广播监听
    this.startUDPListener();
    
    // 2. 启动mDNS查询
    this.startMDNSQuery();
    
    // 3. 启动周期性广播
    this.announceTimer = window.setInterval(() => {
      this.broadcastAnnounce();
    }, ANNOUNCE_INTERVAL_MS);
    
    // 4. 启动对等设备清理
    this.cleanupTimer = window.setInterval(() => {
      this.cleanupStalePeers();
    }, PEER_TIMEOUT_MS / 2);
    
    // 5. 初始广播
    this.broadcastAnnounce();
  }

  stop() {
    this.broadcastBye();
    if (this.announceTimer) clearInterval(this.announceTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.udpSocket) this.udpSocket.close();
  }

  // ---- UDP广播 ----

  private startUDPListener() {
    // 浏览器/PWA：通过WebSocket连接信令服务器
    // Tauri：通过Tauri命令使用Rust UDP套接字
    // 这是跨平台抽象层
    
    if (isTauriEnvironment()) {
      this.startTauriUDPListener();
    } else {
      this.startWebSocketListener();
    }
  }

  private async startTauriUDPListener() {
    // Tauri调用Rust后端处理原始UDP
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('start_udp_listener', {
        port: DISCOVERY_PORT,
      });
      // 监听Rust后端事件
      const { listen } = await import('@tauri-apps/api/event');
      await listen('udp-message', (event: any) => {
        this.handleDiscoveryMessage(event.payload);
      });
    } catch (e) {
      console.warn('Tauri UDP失败，回退到WebSocket:', e);
      this.startWebSocketListener();
    }
  }

  private startWebSocketListener() {
    // PWA模式：连接信令服务器进行对等发现
    if (!this.signalServerUrl) return;
    
    const ws = new WebSocket(this.signalServerUrl);
    ws.onmessage = (event) => {
      try {
        const msg: DiscoveryMessage = JSON.parse(event.data);
        this.handleDiscoveryMessage(msg);
      } catch (e) {
        console.warn('无效的发现消息:', e);
      }
    };
    ws.onclose = () => {
      // 延迟重连
      setTimeout(() => this.startWebSocketListener(), 3000);
    };
  }

  // ---- mDNS查询 ----

  private startMDNSQuery() {
    // mDNS由Tauri中的Rust后端处理
    // PWA依赖信令服务器获取对等列表
    if (isTauriEnvironment()) {
      this.sendMDNSQuery();
    }
  }

  private async sendMDNSQuery() {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('send_mdns_query', {
        serviceType: '_filebridgelan._tcp',
        timeout: 2000,
      });
    } catch (e) {
      console.warn('mDNS查询失败:', e);
    }
  }

  // ---- 消息广播 ----

  private broadcastAnnounce() {
    this.deviceInfo.lastSeen = Date.now();
    const msg: DiscoveryMessage = {
      type: 'announce',
      device: this.deviceInfo,
      timestamp: Date.now(),
    };
    this.sendToAllTransports(msg);
  }

  private broadcastBye() {
    const msg: DiscoveryMessage = {
      type: 'bye',
      device: this.deviceInfo,
      timestamp: Date.now(),
    };
    this.sendToAllTransports(msg);
  }

  private sendToAllTransports(msg: DiscoveryMessage) {
    // 通过UDP发送（Tauri）
    if (isTauriEnvironment()) {
      this.sendUDP(msg);
    }
    // 通过WebSocket发送（PWA）
    this.sendWebSocket(msg);
  }

  private async sendUDP(msg: DiscoveryMessage) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('broadcast_udp', {
        message: JSON.stringify(msg),
        port: DISCOVERY_PORT,
      });
    } catch (e) {
      // 静默失败
    }
  }

  private sendWebSocket(msg: DiscoveryMessage) {
    // WebSocket发送由信令服务器连接处理
    // 服务器将消息中继给其他对等设备
  }

  // ---- 消息处理 ----

  private handleDiscoveryMessage(msg: DiscoveryMessage) {
    // 忽略自身消息
    if (msg.device.id === this.deviceId) return;

    switch (msg.type) {
      case 'announce':
      case 'response':
        this.addOrUpdatePeer(msg.device);
        break;
      case 'bye':
        this.removePeer(msg.device.id);
        break;
      case 'query':
        this.handleQuery(msg);
        break;
    }
  }

  private handleQuery(msg: DiscoveryMessage) {
    // 回复我们的设备信息
    const response: DiscoveryMessage = {
      type: 'response',
      device: this.deviceInfo,
      timestamp: Date.now(),
    };
    this.sendToAllTransports(response);
  }

  private addOrUpdatePeer(device: DeviceInfo) {
    const existing = this.peers.get(device.id);
    device.lastSeen = Date.now();
    this.peers.set(device.id, device);
    
    if (!existing && this.onPeerJoin) {
      this.onPeerJoin(device);
    }
  }

  private removePeer(deviceId: string) {
    this.peers.delete(deviceId);
    if (this.onPeerLeave) {
      this.onPeerLeave(deviceId);
    }
  }

  private cleanupStalePeers() {
    const now = Date.now();
    for (const [id, device] of this.peers) {
      if (now - device.lastSeen > PEER_TIMEOUT_MS) {
        this.removePeer(id);
      }
    }
  }
}

// ---- 辅助函数 ----

function detectOS(): string {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('win')) return 'win32';
  if (platform.includes('mac')) return 'darwin';
  if (platform.includes('linux')) return 'linux';
  if (/android/.test(navigator.userAgent.toLowerCase())) return 'android';
  if (/iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase())) return 'ios';
  return 'unknown';
}

function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

// ---- 设备发现协议（JSON Schema）----
// 
// 发现消息格式：
// {
//   "type": "announce" | "query" | "response" | "bye",
//   "device": {
//     "id": "a1b2c3d4",           // 唯一设备指纹
//     "name": "我的电脑",           // 用户设置的设备名称
//     "type": "desktop",           // desktop | mobile | server
//     "ip": "192.168.1.100",       // 局域网IP
//     "port": 42069,               // 发现端口
//     "capabilities": ["ws", "webrtc", "http"],
//     "os": "win32",               // 操作系统
//     "version": "0.1.0",          // Filebridge-Lan版本
//     "lastSeen": 1717000000000    // 时间戳
//   },
//   "timestamp": 1717000000000
// }
// 
// 传输层：UDP多播 (224.0.0.251:42069) + WebSocket中继
// 编码：JSON over UTF-8
// 频率：每5秒广播，15秒无响应视为离线
