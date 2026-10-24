import { useState, useRef, useCallback, useEffect } from 'react';
import { WebRTCManager } from './transfer/webrtc';
import { HttpTransfer } from './http/HttpTransfer';
import { useHubInfo } from './http/useHubInfo';
import { CopyButton } from './components/CopyButton';
import { JoinQr } from './components/JoinQr';
import { SettingsPanel } from './components/SettingsPanel';
import { RelayTransfer } from './relay/RelayTransfer';
import { isRelayHosted, parseRelayHash } from './relay/api';
import { formatBytes } from './lib/format';
import { resolvePhoneBase, SIGNAL_URL } from './lib/hub';

const CHUNK_SIZE = 64 * 1024; // 64KB：避开 DataChannel 单条消息上限
const RECEIVE_TIMEOUT_MS = 30000;
const UI_UPDATE_INTERVAL_MS = 200;
const WRITE_TIMEOUT_MS = 30000;

type View = 'home' | 'host' | 'client';
type ConnStatus = 'disconnected' | 'connecting' | 'connected';

interface FileItem {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: 'pending' | 'sending' | 'done' | 'error';
  error?: string;
}

interface IncomingFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  chunks: ArrayBuffer[]; // 仅小文件使用；流式接收时为空
  receivedBytes: number;
  savedToDisk: boolean;
}

interface Sink {
  write(data: ArrayBuffer): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

interface ReceiveProgress {
  receivedBytes: number;
  receivedCount: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function sanitizeFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() || 'file').trim() || 'file';
  let safe = base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/^\.+$/, '_');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(safe)) {
    safe = `_${safe}`;
  }
  return safe.slice(0, 200) || 'file';
}

function makeId(): string {
  try {
    if (crypto.randomUUID) return crypto.randomUUID().slice(0, 8);
  } catch {
    // ignore
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 从 ?room= 读取扫码房间码；只接受 4–6 位字母数字。 */
function readRoomCode(): string {
  try {
    const raw = (new URLSearchParams(window.location.search).get('room') || '').trim().toUpperCase();
    return /^[A-Z0-9]{4,6}$/.test(raw) ? raw : '';
  } catch {
    return '';
  }
}

/** StreamSaver 返回的是 WritableStream；必须 getWriter()，且只接受 Uint8Array。 */
function createStreamSaverSink(name: string, size: number): Sink {
  // UMD 全局名是 window.streamSaver（小写 s）；保留大写兼容旧版本
  const streamSaver = (window as any).streamSaver ?? (window as any).StreamSaver;
  if (!streamSaver?.createWriteStream) {
    throw new Error('当前浏览器未加载 StreamSaver，无法接收大文件；请改用 HTTP 传输');
  }

  const stream = streamSaver.createWriteStream(sanitizeFileName(name), { size });
  const writer = stream.getWriter();

  return {
    write: (data: ArrayBuffer) => writer.write(new Uint8Array(data)),
    close: () => writer.close(),
    abort: () => writer.abort(),
  };
}

function App() {
  const [view, setView] = useState<View>('home');
  const [roomCode, setRoomCode] = useState('');
  const [inputCode, setInputCode] = useState(readRoomCode);
  const [connStatus, setConnStatus] = useState<ConnStatus>('disconnected');
  const [peerName, setPeerName] = useState('');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [receivedFiles, setReceivedFiles] = useState<FileItem[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [homeError, setHomeError] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const hubInfo = useHubInfo();
  const phoneBase = hubInfo ? resolvePhoneBase(hubInfo) : '';
  const initialRoomCode = useRef(readRoomCode()).current;
  const autoJoinRef = useRef(false);

  const rtcRef = useRef<WebRTCManager | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deviceId = useRef(makeId());
  const deviceName = useRef(`设备-${deviceId.current.substring(0, 4)}`);

  const incomingRef = useRef<Map<string, IncomingFile>>(new Map());
  const sinksRef = useRef<Map<string, Sink>>(new Map());
  const progressRef = useRef<Map<string, ReceiveProgress>>(new Map());
  const receiveTimersRef = useRef<Map<string, number>>(new Map());
  const lastReceiveUiRef = useRef<Map<string, number>>(new Map());
  const lastSendUiRef = useRef<Map<string, number>>(new Map());
  const failedReceivesRef = useRef<Set<string>>(new Set());
  const abortedSendsRef = useRef<Set<string>>(new Set());

  const addLog = useCallback((msg: string) => {
    setLog(prev => [...prev.slice(-50), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const clearReceiveTimer = useCallback((id: string) => {
    const timer = receiveTimersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      receiveTimersRef.current.delete(id);
    }
  }, []);

  const dropIncoming = useCallback((id: string) => {
    clearReceiveTimer(id);
    const sink = sinksRef.current.get(id);
    if (sink) {
      try {
        sink.abort().catch(() => {});
      } catch {
        // 忽略 abort 失败
      }
      sinksRef.current.delete(id);
    }
    incomingRef.current.delete(id);
    progressRef.current.delete(id);
    lastReceiveUiRef.current.delete(id);
  }, [clearReceiveTimer]);

  const markReceiveFailed = useCallback((id: string, reason: string) => {
    if (failedReceivesRef.current.has(id)) return;
    failedReceivesRef.current.add(id);

    dropIncoming(id);
    setReceivedFiles(prev => prev.map(f => (f.id === id ? { ...f, status: 'error', error: reason } : f)));
    addLog(`接收失败: ${reason}`);

    // 通知发送端停止，避免对方继续空转
    try {
      rtcRef.current?.sendControl({ type: 'file_abort', id, reason });
    } catch {
      // 通道已关闭，忽略
    }
  }, [addLog, dropIncoming]);

  const armReceiveTimer = useCallback((id: string) => {
    clearReceiveTimer(id);
    const timer = window.setTimeout(() => {
      markReceiveFailed(id, '30 秒未收到新数据，传输已中止');
    }, RECEIVE_TIMEOUT_MS);
    receiveTimersRef.current.set(id, timer);
  }, [clearReceiveTimer, markReceiveFailed]);

  const triggerDownload = useCallback((blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sanitizeFileName(name);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  // ---- 接收 ----

  const handleData = useCallback(async (data: ArrayBuffer) => {
    let meta: any;
    let fileData: ArrayBuffer;

    try {
      const view = new DataView(data);
      const metaLen = view.getUint32(0, true);
      if (metaLen === 0 || metaLen > data.byteLength - 4) {
        throw new Error('帧头无效');
      }
      const metaStr = new TextDecoder().decode(data.slice(4, 4 + metaLen));
      meta = JSON.parse(metaStr);
      fileData = data.slice(4 + metaLen);
    } catch (e) {
      addLog(`收到无效数据帧: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    // 对方中止
    if (meta.type === 'file_abort') {
      const id = meta.id;
      abortedSendsRef.current.add(id);
      dropIncoming(id);
      setReceivedFiles(prev => prev.map(f => (f.id === id ? { ...f, status: 'error', error: meta.reason } : f)));
      addLog(`对方中止接收: ${meta.reason || '未说明原因'}`);
      return;
    }

    if (meta.type === 'file_meta') {
      if (typeof meta.id !== 'string' || typeof meta.name !== 'string' || !meta.name) {
        addLog('文件元数据缺少 id/name，已忽略');
        return;
      }
      if (typeof meta.size !== 'number' || meta.size < 0) {
        addLog('文件元数据无效，已忽略');
        return;
      }

      // 空文件：直接生成空文件下载
      if (meta.size === 0) {
        triggerDownload(new Blob([], { type: meta.mimeType || 'application/octet-stream' }), meta.name);
        setReceivedFiles(prev => [...prev, {
          id: meta.id,
          name: meta.name,
          size: 0,
          progress: 0,
          status: 'done',
        }]);
        addLog(`收到空文件: ${meta.name}`);
        return;
      }

      // 小文件：元数据与数据在同一帧
      if (fileData.byteLength > 0) {
        if (fileData.byteLength !== meta.size) {
          addLog(`小文件数据不完整: 期望 ${meta.size}，实际 ${fileData.byteLength}`);
          return;
        }
        const incoming: IncomingFile = {
          id: meta.id,
          name: meta.name,
          size: meta.size,
          mimeType: meta.mimeType,
          chunks: [fileData],
          receivedBytes: fileData.byteLength,
          savedToDisk: false,
        };
        incomingRef.current.set(meta.id, incoming);
        setReceivedFiles(prev => [...prev, {
          id: meta.id,
          name: meta.name,
          size: meta.size,
          progress: meta.size,
          status: 'done',
        }]);
        triggerDownload(new Blob(incoming.chunks, { type: meta.mimeType }), meta.name);
        addLog(`收到文件: ${meta.name} (${formatBytes(meta.size)})`);
        return;
      }

      // 大文件：先建立接收上下文，再建 sink（必须同步建立，避免 chunk 竞态）
      failedReceivesRef.current.delete(meta.id);
      const incoming: IncomingFile = {
        id: meta.id,
        name: meta.name,
        size: meta.size,
        mimeType: meta.mimeType,
        chunks: [],
        receivedBytes: 0,
        savedToDisk: false,
      };
      incomingRef.current.set(meta.id, incoming);
      progressRef.current.set(meta.id, { receivedBytes: 0, receivedCount: 0 });
      setReceivedFiles(prev => [...prev, {
        id: meta.id,
        name: meta.name,
        size: meta.size,
        progress: 0,
        status: 'sending',
      }]);

      try {
        const sink = createStreamSaverSink(meta.name, meta.size);
        sinksRef.current.set(meta.id, sink);
        addLog(`开始接收: ${meta.name} (${formatBytes(meta.size)})`);
      } catch (e) {
        markReceiveFailed(meta.id, e instanceof Error ? e.message : String(e));
        return;
      }

      armReceiveTimer(meta.id);
      return;
    }

    if (meta.type === 'file_chunk') {
      const incoming = incomingRef.current.get(meta.id);
      const sink = sinksRef.current.get(meta.id);
      const progress = progressRef.current.get(meta.id);

      if (!incoming || !sink || !progress) {
        // 没有接收上下文时不要 ACK，避免发送端误以为成功
        if (!failedReceivesRef.current.has(meta.id)) {
          markReceiveFailed(meta.id, '接收上下文缺失');
        }
        return;
      }

      try {
        await withTimeout(sink.write(fileData), WRITE_TIMEOUT_MS, '写入磁盘超时');
      } catch (e) {
        markReceiveFailed(meta.id, `写入失败: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }

      progress.receivedBytes += fileData.byteLength;
      progress.receivedCount++;
      incoming.receivedBytes = progress.receivedBytes;
      armReceiveTimer(meta.id);

      const now = Date.now();
      const last = lastReceiveUiRef.current.get(meta.id) || 0;
      if (now - last >= UI_UPDATE_INTERVAL_MS || progress.receivedBytes >= incoming.size) {
        lastReceiveUiRef.current.set(meta.id, now);
        const received = progress.receivedBytes;
        setReceivedFiles(prev => prev.map(f => (
          f.id === meta.id
            ? { ...f, progress: received, status: received >= f.size ? 'done' : 'sending' }
            : f
        )));
      }

      // 写入成功后再 ACK
      rtcRef.current?.sendChunkAck(meta.id, meta.index);

      const total = typeof meta.total === 'number' ? meta.total : 0;
      if (progress.receivedCount >= total && progress.receivedBytes === incoming.size) {
        clearReceiveTimer(meta.id);
        try {
          await withTimeout(sink.close(), WRITE_TIMEOUT_MS, '关闭文件超时');
          incoming.savedToDisk = true;
          addLog(`文件保存完成: ${incoming.name}`);
        } catch (e) {
          markReceiveFailed(meta.id, `关闭文件失败: ${e instanceof Error ? e.message : String(e)}`);
          return;
        }

        sinksRef.current.delete(meta.id);
        incomingRef.current.delete(meta.id);
        progressRef.current.delete(meta.id);
        lastReceiveUiRef.current.delete(meta.id);
        setReceivedFiles(prev => prev.map(f => (
          f.id === meta.id ? { ...f, progress: f.size, status: 'done' } : f
        )));
      } else if (progress.receivedBytes > incoming.size) {
        markReceiveFailed(meta.id, '接收字节数超过文件大小');
      }
    }
  }, [addLog, armReceiveTimer, clearReceiveTimer, dropIncoming, markReceiveFailed, triggerDownload]);

  // ---- 发送 ----

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!rtcRef.current) {
      addLog('错误: 未连接');
      return;
    }
    if (!rtcRef.current.isConnected()) {
      addLog('错误: P2P 通道尚未建立，请等待“已连接”');
      return;
    }

    const id = makeId();
    addLog(`发送文件: ${file.name} (${formatBytes(file.size)})`);
    setFiles(prev => [...prev, { id, name: file.name, size: file.size, progress: 0, status: 'sending' }]);

    const meta = JSON.stringify({
      type: 'file_meta',
      id,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
    });
    const metaBytes = new TextEncoder().encode(meta);

    try {
      if (file.size <= CHUNK_SIZE) {
        // 小文件：元数据 + 数据一帧发完
        const buffer = await file.arrayBuffer();
        const packet = new ArrayBuffer(4 + metaBytes.byteLength + buffer.byteLength);
        new DataView(packet).setUint32(0, metaBytes.byteLength, true);
        new Uint8Array(packet, 4).set(metaBytes);
        new Uint8Array(packet, 4 + metaBytes.byteLength).set(new Uint8Array(buffer));

        rtcRef.current.sendData(packet);
        setFiles(prev => prev.map(f => (f.id === id ? { ...f, progress: f.size, status: 'done' } : f)));
        addLog(`文件已发送: ${file.name}`);
        return;
      }

      // 大文件：先发元数据（不带数据），再逐块发送
      const header = new ArrayBuffer(4 + metaBytes.byteLength);
      new DataView(header).setUint32(0, metaBytes.byteLength, true);
      new Uint8Array(header, 4).set(metaBytes);
      rtcRef.current.sendData(header);

      let offset = 0;
      let index = 0;
      const total = Math.ceil(file.size / CHUNK_SIZE);

      while (offset < file.size) {
        if (abortedSendsRef.current.has(id)) {
          abortedSendsRef.current.delete(id);
          throw new Error('对方已中止接收');
        }

        const chunk = file.slice(offset, offset + CHUNK_SIZE);
        const buffer = await chunk.arrayBuffer();
        const chunkMeta = JSON.stringify({
          type: 'file_chunk',
          id,
          index,
          total,
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
        });
        const chunkMetaBytes = new TextEncoder().encode(chunkMeta);
        const packet = new ArrayBuffer(4 + chunkMetaBytes.byteLength + buffer.byteLength);
        new DataView(packet).setUint32(0, chunkMetaBytes.byteLength, true);
        new Uint8Array(packet, 4).set(chunkMetaBytes);
        new Uint8Array(packet, 4 + chunkMetaBytes.byteLength).set(new Uint8Array(buffer));

        await rtcRef.current.sendDataWait(packet);

        offset += buffer.byteLength;
        index++;

        const now = Date.now();
        const last = lastSendUiRef.current.get(id) || 0;
        if (now - last >= UI_UPDATE_INTERVAL_MS || offset >= file.size) {
          lastSendUiRef.current.set(id, now);
          const sent = offset;
          setFiles(prev => prev.map(f => (
            f.id === id
              ? { ...f, progress: sent, status: sent >= f.size ? 'done' : 'sending' }
              : f
          )));
        }
      }

      lastSendUiRef.current.delete(id);
      setFiles(prev => prev.map(f => (f.id === id ? { ...f, progress: f.size, status: 'done' } : f)));
      addLog(`文件已发送: ${file.name}`);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      lastSendUiRef.current.delete(id);
      setFiles(prev => prev.map(f => (f.id === id ? { ...f, status: 'error', error: reason } : f)));
      addLog(`发送失败: ${reason}`);
      try {
        rtcRef.current?.sendControl({ type: 'file_abort', id, reason });
      } catch {
        // 通道已关闭
      }
    }
  }, [addLog]);

  // ---- 连接 ----

  const handleConnectionLost = useCallback((reason: string) => {
    setConnStatus('disconnected');
    addLog(reason);
    for (const id of Array.from(sinksRef.current.keys())) {
      markReceiveFailed(id, reason);
    }
  }, [addLog, markReceiveFailed]);

  const createManager = useCallback(() => {
    return new WebRTCManager(deviceId.current, deviceName.current, SIGNAL_URL, {
      onPeerJoined: (_id, name) => {
        setPeerName(name);
        addLog(`设备加入: ${name}`);
      },
      onConnected: () => {
        setConnStatus('connected');
        addLog('P2P 连接已建立');
      },
      onDisconnected: () => handleConnectionLost('连接断开'),
      onPeerLeft: () => handleConnectionLost('对方已离开'),
      onData: handleData,
      onChunkAck: () => {
        // ACK 已用于接收端确认；发送端暂不做重传
      },
      onError: (err) => addLog(`错误: ${err}`),
    });
  }, [addLog, handleConnectionLost, handleData]);

  const handleCreateRoom = useCallback(async () => {
    setHomeError('');
    setView('host');
    setConnStatus('connecting');
    addLog('创建房间...');

    const rtc = createManager();
    rtcRef.current = rtc;

    try {
      const code = await rtc.createRoom();
      setRoomCode(code);
      addLog(`房间码: ${code}`);
    } catch (e) {
      setConnStatus('disconnected');
      setView('home');
      const message = e instanceof Error ? e.message : String(e);
      setHomeError(`创建房间失败：${message}`);
      addLog(`创建房间失败: ${message}`);
    }
  }, [addLog, createManager]);

  const joinRoomByCode = useCallback(async (rawCode: string, attempts = 1) => {
    const code = rawCode.trim().toUpperCase();
    if (!code) return;

    setHomeError('');
    setInputCode(code);
    setView('client');
    setConnStatus('connecting');

    let retries = 0;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      setConnStatus('connecting');
      addLog(attempt === 1
        ? `加入房间 ${code}...`
        : `重试加入房间 ${code}（${attempt}/${attempts}）...`);

      const rtc = createManager();
      rtcRef.current = rtc;

      try {
        await rtc.joinRoom(code);
        addLog('已加入房间，等待 P2P 连接...');
        return;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        try {
          rtc.disconnect();
        } catch {
          // ignore
        }
        if (rtcRef.current === rtc) rtcRef.current = null;

        const retryable = message.includes('信令服务器连接失败')
          || message.includes('超时')
          || message.includes('房间已满');
        if (attempt < attempts && retryable) {
          retries += 1;
          addLog(`加入失败（${message}），准备重试...`);
          await new Promise(resolve => window.setTimeout(resolve, 500 * attempt));
          continue;
        }

        setConnStatus('disconnected');
        setView('home');
        setHomeError(`加入房间失败：${message}${retries > 0 ? `（已重试 ${retries} 次）` : ''}`);
        addLog(`加入房间失败: ${message}`);
        return;
      }
    }
  }, [addLog, createManager]);

  const handleJoinRoom = useCallback(() => {
    void joinRoomByCode(inputCode, 1);
  }, [inputCode, joinRoomByCode]);

  // 手机扫码打开 ?room=CODE 时自动加入；信令暂时不可用时重试两次
  useEffect(() => {
    if (autoJoinRef.current) return;
    autoJoinRef.current = true;
    if (!initialRoomCode) return;
    addLog(`检测到扫码房间码 ${initialRoomCode}，正在自动加入...`);
    void joinRoomByCode(initialRoomCode, 3);
  }, [addLog, initialRoomCode, joinRoomByCode]);

  const handleDisconnect = useCallback(() => {
    for (const id of Array.from(sinksRef.current.keys())) {
      dropIncoming(id);
    }
    for (const timer of receiveTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    receiveTimersRef.current.clear();
    incomingRef.current.clear();
    progressRef.current.clear();
    failedReceivesRef.current.clear();
    abortedSendsRef.current.clear();
    lastReceiveUiRef.current.clear();
    lastSendUiRef.current.clear();

    rtcRef.current?.disconnect();
    rtcRef.current = null;
    setConnStatus('disconnected');
    setView('home');
    setRoomCode('');
    setPeerName('');
    setHomeError('');
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('room');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // ignore
    }
    addLog('已断开连接');
  }, [addLog, dropIncoming]);

  useEffect(() => {
    return () => {
      rtcRef.current?.disconnect();
      for (const timer of receiveTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && fileInputRef.current) {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInputRef.current.files = dt.files;
      fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // ---- UI ----

  const relayLink = parseRelayHash();
  const relayOnly = isRelayHosted();

  if (relayLink) {
    return (
      <div className="app relay-receive-app">
        <header className="header home-header">
          <div className="home-title">
            <h1>📥 Filebridge-Lan</h1>
            <p className="status">跨网络加密接收</p>
          </div>
        </header>
        <main className="main relay-main">
          <RelayTransfer initialLink={relayLink} standalone />
        </main>
        <footer className="app-footer">Filebridge-Lan v1.3.0 · 端到端加密中继</footer>
      </div>
    );
  }

  if (view === 'home') {
    return (
      <div className="app">
        <header className="header home-header">
          <div className="home-title">
            <h1>📁 Filebridge-Lan</h1>
            <p className="status">
              {relayOnly ? '跨网络加密传输' : '同一 WiFi · 免安装 · 大文件直传'}
            </p>
          </div>
          {!relayOnly && (
            <button type="button" className="btn btn-small settings-button" onClick={() => setShowSettings(true)}>
              ⚙ 设置
            </button>
          )}
        </header>
        {homeError && (
          <div className="notice notice-bad home-error">
            <p className="text-error">{homeError}</p>
            {inputCode && (
              <button
                type="button"
                className="btn btn-small"
                style={{ marginTop: 8 }}
                onClick={handleJoinRoom}
              >
                重试加入
              </button>
            )}
          </div>
        )}
        <main
          className="main home-main"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', maxWidth: 980, margin: '0 auto' }}
        >
          {!relayOnly && <HttpTransfer />}
          {!relayOnly && (
            <section className="panel">
              <div className="panel-head">
                <h2>🔗 WebRTC 房间（可选）</h2>
                <span className="chip">小文件</span>
              </div>
              <p className="hint" style={{ marginBottom: 14 }}>
                适合 ≤64KB 的小文件；创建房间后会出现手机扫码入口。
              </p>
              <div className="connect-form">
                <button type="button" className="btn btn-primary" onClick={handleCreateRoom}>
                  🏠 创建房间
                </button>
                <div className="divider" />
                <input
                  className="input"
                  placeholder="输入房间码"
                  value={inputCode}
                  onChange={e => setInputCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="房间码"
                  style={{ textAlign: 'center', fontSize: '1.2rem', letterSpacing: 4 }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleJoinRoom}
                  disabled={!inputCode.trim()}
                >
                  🔗 加入房间
                </button>
              </div>
              <p className="hint" style={{ marginTop: 12 }}>
                手机也可以直接扫码加入；没有摄像头时手动输入房间码。
              </p>
            </section>
          )}
          <RelayTransfer />
        </main>
        <footer className="app-footer">Filebridge-Lan v1.3.0 · 局域网直传 / 跨网络中继</footer>
        {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      </div>
    );
  }

  const peerLabel = peerName
    ? `对方: ${peerName}`
    : connStatus === 'disconnected'
      ? '连接已断开'
      : view === 'client'
        ? connStatus === 'connected'
          ? '对方已连接'
          : '正在连接对方…'
        : '等待对方加入…';

  return (
    <div className="app">
      <header className="room-header">
        <div className="header-top">
          <div className="brand">
            <h1>📁 Filebridge-Lan</h1>
            <p className="status">局域网文件传输</p>
          </div>
          <div className="header-actions">
            <span className={`chip ${connStatus === 'connected' ? 'chip-ok' : connStatus === 'connecting' ? 'chip-warn' : 'chip-bad'}`}>
              {connStatus === 'connected' ? '已连接' : connStatus === 'connecting' ? '连接中' : '未连接'}
            </span>
            <button type="button" className="btn btn-small" onClick={handleDisconnect}>断开</button>
          </div>
        </div>
        <div className="room-meta">
          {view === 'host' ? (
            <div className="room-code">
              <span className="hint">房间码</span>
              <strong>{roomCode || '------'}</strong>
              {roomCode && <CopyButton text={roomCode} label="复制房间码" />}
            </div>
          ) : (
            <div className="room-code">
              <span className="hint">已加入</span>
              <strong>{inputCode}</strong>
            </div>
          )}
          <span className="peer">{peerLabel}</span>
        </div>
      </header>

      {view === 'host' && roomCode && (
        phoneBase ? (
          <JoinQr
            url={`${phoneBase}/?room=${encodeURIComponent(roomCode)}`}
            title="手机扫码直接进房间"
            subtitle="扫码后自动加入；同一 WiFi 即可，无需输入房间码"
          />
        ) : (
          <p className="hint">未检测到 Hub 或局域网 IP，无法生成扫码入口；请确认 HTTP Hub 已启动后刷新。</p>
        )
      )}

      <main className="main" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {/* 发送区 */}
        <section className="panel">
          <div className="panel-head">
            <h2>📤 发送文件</h2>
            <span className="chip">WebRTC</span>
          </div>
          <div
            className="drop-zone"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="选择要发送的文件"
            style={{ marginBottom: 12 }}
          >
            <p>拖放文件到此处</p>
            <p className="hint">或点击选择文件</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            aria-label="选择要发送的文件"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          {files.length > 0 && (
            <div className="file-list">
              {files.map(f => (
                <div key={f.id} className="file-item">
                  <div className="file-name">{f.name}</div>
                  <div className="file-progress">
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${f.size > 0 ? (f.progress / f.size) * 100 : 100}%` }} />
                    </div>
                    <span className="file-status">
                      {f.status === 'done' ? '✅' : f.status === 'error' ? `❌ ${f.error || ''}` : `${formatBytes(f.progress)}/${formatBytes(f.size)}`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 接收区 */}
        <section className="panel">
          <div className="panel-head">
            <h2>📥 接收文件</h2>
            <span className="chip">WebRTC</span>
          </div>
          {receivedFiles.length === 0 ? (
            <div className="empty-state">
              <span aria-hidden>📥</span>
              <p>等待对方发送文件…</p>
              <p className="hint">大文件建议用上方 HTTP 直传</p>
            </div>
          ) : (
            <div className="file-list">
              {receivedFiles.map(f => {
                const incoming = incomingRef.current.get(f.id);
                return (
                  <div key={f.id} className="file-item">
                    <div className="file-name">{f.name}</div>
                    <div className="file-progress">
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${f.size > 0 ? (f.progress / f.size) * 100 : 100}%` }} />
                      </div>
                      <span className="file-status">
                        {f.status === 'error' ? (
                          <span title={f.error}>❌ {f.error || '失败'}</span>
                        ) : f.status === 'done' ? (
                          incoming && incoming.chunks.length > 0 ? (
                            <button
                              type="button"
                              className="btn btn-small"
                              onClick={() => {
                                triggerDownload(new Blob(incoming.chunks, { type: incoming.mimeType }), incoming.name);
                                setReceivedFiles(prev => prev.filter(x => x.id !== incoming.id));
                              }}
                              style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                            >
                              ⬇ 下载
                            </button>
                          ) : (
                            '✅ 已保存到磁盘'
                          )
                        ) : `${formatBytes(f.progress)}/${formatBytes(f.size)}`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <section className="log-panel">
        <h3>日志</h3>
        <div className="log-list">
          {log.map((l, i) => (
            <div key={i} className="log-item">{l}</div>
          ))}
        </div>
      </section>
      <footer className="app-footer">Filebridge-Lan v1.3.0 · 仅局域网内传输</footer>
    </div>
  );
}

export default App;
