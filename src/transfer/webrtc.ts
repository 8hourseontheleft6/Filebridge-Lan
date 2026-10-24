/**
 * Filebridge-Lan - WebRTC连接管理
 *
 * 通过信令服务器建立P2P连接
 * 使用DataChannel传输文件数据
 *
 * 可靠性约定：
 * - sendData / sendDataWait 在通道不可用时抛错，绝不静默丢包
 * - 等待 DataChannel 有超时
 * - 背压等待有超时
 * - 通道关闭/连接失败会通知上层
 */

const STUN_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  iceTransportPolicy: 'all' as RTCIceTransportPolicy,
};

const SIGNAL_TIMEOUT_MS = 10000;
const CHANNEL_OPEN_TIMEOUT_MS = 15000;
const BUFFER_TIMEOUT_MS = 60000;
const BUFFER_LOW_THRESHOLD = 4 * 1024 * 1024;

export type SignalCallback = {
  onPeerJoined?: (deviceId: string, deviceName: string) => void;
  onPeerLeft?: () => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onData?: (data: ArrayBuffer) => void;
  onChunkAck?: (transferId: string, index: number) => void;
  onError?: (error: string) => void;
};

export class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private ws: WebSocket | null = null;
  private roomId: string = '';
  private deviceId: string;
  private deviceName: string;
  private isHost: boolean = false;
  private callbacks: SignalCallback;
  private signalUrl: string;
  private connected: boolean = false;
  private disposed: boolean = false;
  private bufferThreshold: number = 8 * 1024 * 1024;
  private pendingCandidates: RTCIceCandidateInit[] = [];

  constructor(deviceId: string, deviceName: string, signalUrl: string, callbacks: SignalCallback) {
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.signalUrl = signalUrl;
    this.callbacks = callbacks;
  }

  /** 作为Host创建房间 */
  async createRoom(): Promise<string> {
    this.isHost = true;
    await this.connectSignaling();
    const created = this.waitForSignal('room_created', SIGNAL_TIMEOUT_MS);
    this.send({ type: 'create_room', deviceId: this.deviceId, deviceName: this.deviceName });
    const msg = await created;
    this.roomId = msg.roomId;
    return msg.roomId;
  }

  /** 作为Client加入房间 */
  async joinRoom(roomId: string): Promise<void> {
    this.isHost = false;
    this.roomId = roomId;
    await this.connectSignaling();
    const joined = this.waitForSignal('room_joined', SIGNAL_TIMEOUT_MS);
    this.send({ type: 'join_room', roomId, deviceId: this.deviceId, deviceName: this.deviceName });
    await joined;
  }

  /** 发送数据。通道不可用时抛错，由调用方决定如何失败。 */
  sendData(data: ArrayBuffer): void {
    if (!this.dc || this.dc.readyState !== 'open') {
      throw new Error('DataChannel 未就绪，无法发送');
    }
    this.dc.send(data);
  }

  /** 发送一条 JSON 控制消息（带 4 字节长度前缀） */
  sendControl(message: Record<string, unknown>): void {
    const bytes = new TextEncoder().encode(JSON.stringify(message));
    const packet = new ArrayBuffer(4 + bytes.byteLength);
    new DataView(packet).setUint32(0, bytes.byteLength, true);
    new Uint8Array(packet, 4).set(bytes);
    this.sendData(packet);
  }

  /** 发送分块ACK确认。通道已关闭时静默忽略，由接收端看门狗兜底。 */
  sendChunkAck(transferId: string, index: number): void {
    try {
      this.sendControl({ type: 'chunk_ack', transferId, index });
    } catch {
      // 通道已关闭，无需再确认
    }
  }

  /** 发送数据并等待通道就绪 + 背压释放。失败时抛错。 */
  async sendDataWait(data: ArrayBuffer): Promise<void> {
    await this.waitForChannel(CHANNEL_OPEN_TIMEOUT_MS);
    await this.waitForBuffer(BUFFER_TIMEOUT_MS);
    this.sendData(data);
  }

  /** 断开连接 */
  disconnect(): void {
    this.disposed = true;
    this.connected = false;
    this.pendingCandidates = [];

    if (this.dc) {
      try { this.dc.close(); } catch { /* ignore */ }
      this.dc = null;
    }
    if (this.pc) {
      try { this.pc.close(); } catch { /* ignore */ }
      this.pc = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
  }

  getRoomId(): string { return this.roomId; }
  isHostDevice(): boolean { return this.isHost; }
  isConnected(): boolean { return this.connected; }

  // ---- 信令 ----

  private connectSignaling(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.signalUrl);
      this.ws = ws;

      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('信令服务器连接失败'));
      ws.onmessage = (event) => this.handleSignal(event);
      ws.onclose = () => {
        if (this.connected) {
          this.connected = false;
          this.callbacks.onDisconnected?.();
        }
      };
    });
  }

  /** 等待指定类型的信令响应；超时或 error 时 reject，并移除监听器。 */
  private waitForSignal(type: string, timeoutMs: number): Promise<any> {
    const ws = this.ws;
    if (!ws) return Promise.reject(new Error('信令未连接'));

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error(`等待信令 ${type} 超时`));
      }, timeoutMs);

      const onMessage = (event: MessageEvent) => {
        let msg: any;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.type === type) {
          cleanup();
          resolve(msg);
        } else if (msg.type === 'error') {
          cleanup();
          reject(new Error(msg.message || '信令服务器返回错误'));
        }
      };

      const cleanup = () => {
        window.clearTimeout(timer);
        ws.removeEventListener('message', onMessage);
      };

      ws.addEventListener('message', onMessage);
    });
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleSignal(event: MessageEvent): void {
    let msg: any;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'peer_joined':
        this.callbacks.onPeerJoined?.(msg.deviceId, msg.deviceName);
        this.startWebRTC().catch((e) => this.reportError(e));
        break;

      case 'offer':
        this.handleOffer(msg.sdp).catch((e) => this.reportError(e));
        break;

      case 'answer':
        this.handleAnswer(msg.sdp).catch((e) => this.reportError(e));
        break;

      case 'ice_candidate':
        this.handleIceCandidate(msg.candidate).catch((e) => this.reportError(e));
        break;

      case 'host_disconnected':
      case 'peer_disconnected':
        this.connected = false;
        this.callbacks.onPeerLeft?.();
        this.callbacks.onDisconnected?.();
        break;

      case 'error':
        this.callbacks.onError?.(msg.message || '信令错误');
        break;
    }
  }

  private reportError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.callbacks.onError?.(message);
  }

  // ---- WebRTC ----

  private createPeerConnection(): RTCPeerConnection {
    if (this.pc) {
      try { this.pc.close(); } catch { /* ignore */ }
    }

    const pc = new RTCPeerConnection(STUN_SERVERS);
    this.pc = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.send({
          type: 'ice_candidate',
          roomId: this.roomId,
          candidate: event.candidate,
          deviceId: this.deviceId,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        if (this.connected) {
          this.connected = false;
          this.callbacks.onDisconnected?.();
        }
      }
    };

    pc.ondatachannel = (event) => {
      this.dc = event.channel;
      this.setupDataChannel(event.channel);
    };

    return pc;
  }

  private async startWebRTC(): Promise<void> {
    if (this.disposed) return;

    const pc = this.createPeerConnection();
    if (!this.isHost) return;

    this.dc = pc.createDataChannel('filetransfer', { ordered: true });
    this.setupDataChannel(this.dc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send({
      type: 'offer',
      roomId: this.roomId,
      sdp: pc.localDescription,
      deviceId: this.deviceId,
    });
  }

  private setupDataChannel(dc: RTCDataChannel): void {
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;

    dc.onopen = () => {
      this.connected = true;
      this.callbacks.onConnected?.();
    };

    dc.onclose = () => {
      this.connected = false;
      this.callbacks.onDisconnected?.();
    };

    dc.onerror = (e) => {
      console.error('[WebRTC] DataChannel error:', e);
      this.callbacks.onError?.('DataChannel 错误');
    };

    dc.onmessage = (event) => this.handleDataChannelMessage(event);
  }

  private handleDataChannelMessage(event: MessageEvent): void {
    if (!(event.data instanceof ArrayBuffer)) return;

    // 先尝试识别控制消息（chunk_ack 等），其余交给上层
    if (event.data.byteLength >= 5) {
      try {
        const view = new DataView(event.data);
        const metaLen = view.getUint32(0, true);
        if (metaLen > 0 && metaLen < 1024) {
          const metaStr = new TextDecoder().decode(event.data.slice(4, 4 + metaLen));
          const meta = JSON.parse(metaStr);
          if (meta.type === 'chunk_ack' && meta.transferId && meta.index !== undefined) {
            this.callbacks.onChunkAck?.(meta.transferId, meta.index);
            return;
          }
        }
      } catch {
        // 不是控制消息，继续按数据帧处理
      }
    }

    this.callbacks.onData?.(event.data);
  }

  private async handleOffer(sdp: any): Promise<void> {
    const pc = this.createPeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await this.flushPendingCandidates();

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.send({
      type: 'answer',
      roomId: this.roomId,
      sdp: pc.localDescription,
      deviceId: this.deviceId,
    });
  }

  private async handleAnswer(sdp: any): Promise<void> {
    if (!this.pc) throw new Error('收到 answer 但本地没有 PeerConnection');
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await this.flushPendingCandidates();
  }

  private async handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.pc;
    if (!pc) {
      this.pendingCandidates.push(candidate);
      return;
    }
    if (!pc.remoteDescription) {
      this.pendingCandidates.push(candidate);
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn('[WebRTC] 添加 ICE candidate 失败:', e);
    }
  }

  private async flushPendingCandidates(): Promise<void> {
    const pc = this.pc;
    if (!pc) return;

    const pending = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('[WebRTC] 添加缓存 ICE candidate 失败:', e);
      }
    }
  }

  /** 等待 DataChannel 变成 open；关闭/超时都抛错，绝不无限等待。 */
  private waitForChannel(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = Date.now();

      const check = () => {
        if (this.disposed) {
          reject(new Error('连接已关闭'));
          return;
        }

        const dc = this.dc;
        if (dc && dc.readyState === 'open') {
          resolve();
          return;
        }
        if (dc && (dc.readyState === 'closing' || dc.readyState === 'closed')) {
          reject(new Error('DataChannel 已关闭'));
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          reject(new Error('等待 DataChannel 超时'));
          return;
        }

        window.setTimeout(check, 50);
      };

      check();
    });
  }

  /** 等待发送缓冲区降到阈值以下；超时/断线抛错。 */
  private async waitForBuffer(timeoutMs: number): Promise<void> {
    const dc = this.dc;
    if (!dc || dc.readyState !== 'open') {
      throw new Error('DataChannel 未就绪');
    }

    dc.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;
    const deadline = Date.now() + timeoutMs;

    while (dc.bufferedAmount > this.bufferThreshold) {
      if (dc.readyState !== 'open') {
        throw new Error('DataChannel 已关闭');
      }
      if (Date.now() > deadline) {
        throw new Error('发送缓冲区长时间未清空，网络可能中断');
      }

      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          dc.removeEventListener('bufferedamountlow', done);
          resolve();
        };
        dc.addEventListener('bufferedamountlow', done);
        window.setTimeout(done, 200);
      });
    }
  }
}
