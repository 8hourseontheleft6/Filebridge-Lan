import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { formatBytes, formatDuration } from '../lib/format';
import { API_BASE, isTauriHost, resolvePhoneBase, type HubInfo, type LanServiceStatus } from '../lib/hub';
import { JoinQr } from '../components/JoinQr';
import { CopyButton } from '../components/CopyButton';
import { RateCard } from '../components/RateCard';
import { InfoTip } from '../components/InfoTip';
import { Icon } from '../components/Icon';
import { confirmedPercent, hasServerFile, resolveServerOffset, shouldShowLiveUpload } from '../lib/uploadOffsets';
import { ConnectionMonitor, HEARTBEAT_STALE_MS, PROBE_TIMEOUT_MS, isHeartbeatStale } from '../lib/connectionMonitor';
import { ConnectPanel } from './ConnectPanel';
import { NearbyComputers, type NearbyPeer } from './NearbyComputers';
import { ClipboardPanel } from './ClipboardPanel';

const SESSION_STORAGE_KEY = 'filebridge_session_code';
const TOKEN_STORAGE_KEY = 'filebridge_session_token';
const UPLOAD_CHUNK_SIZE = 4 * 1024 * 1024;
const IOS_UPLOAD_CHUNK_SIZE = 2 * 1024 * 1024;
const UPLOAD_CHUNK_TIMEOUT_MS = 90_000;

type UploadTransport = 'xhr-blob' | 'fetch-blob';

function readSessionCode(): string {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const fromHash = params.get('code')?.trim() || '';
  if (fromHash) {
    try { window.sessionStorage.setItem(SESSION_STORAGE_KEY, fromHash); } catch { /* ignore */ }
    return fromHash;
  }
  try {
    return window.sessionStorage.getItem(SESSION_STORAGE_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

function readToken(): string {
  try {
    return window.sessionStorage.getItem(TOKEN_STORAGE_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

async function pairSession(code: string): Promise<{ token: string; expiresAt: number }> {
  const response = await fetch(`${API_BASE}/api/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('配对码错误，请检查电脑上显示的 6 位配对码');
    if (response.status === 429) throw new Error('尝试次数过多，请稍后再试');
    if (response.status === 403) throw new Error('当前网络不允许配对，请确认电脑与手机在同一专用网络');
    throw new Error('无法连接 Filebridge-Lan Hub，请确认电脑端服务在线');
  }
  return (await response.json()) as { token: string; expiresAt: number };
}

interface HubFile {
  id: string;
  name: string;
  size: number;
  sha256: string;
  mime: string;
  createdAt: number;
}

interface SavedFile {
  path: string;
  existed: boolean;
}

interface ToastState {
  text: string;
  kind: 'success' | 'error' | 'info';
  path?: string;
}

interface DownloadProgressPayload {
  transferId: string;
  loaded: number;
  total: number;
  status: 'copying' | 'completed' | 'cancelled' | 'failed';
}

interface ActiveDownload {
  transferId: string;
  name: string;
  loaded: number;
  total: number;
  startedAt: number;
  status: 'copying' | 'cancelling';
}

interface UploadEventPayload {
  id: string;
  name: string;
  loaded: number;
  total: number;
  status: 'started' | 'progress' | 'completed' | 'failed';
}

interface LiveUpload {
  id: string;
  name: string;
  loaded: number;
  total: number;
  startedAt: number;
}

function makeTransferId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const digit = char === 'x' ? value : (value & 0x3) | 0x8;
    return digit.toString(16);
  });
}

interface ServerChunkDiag {
  remoteIp: string;
  offset: number;
  total: number;
  contentLength: number | null;
  transferEncoding: string | null;
  expect: string | null;
  bodyRead: number;
  partSize: number;
  bodyState: string;
  lastError: string | null;
  startedAtMs: number;
  durationMs: number;
  statusCode: number | null;
}

interface UploadState {
  name: string;
  loaded: number;
  total: number;
  startedAt: number;
  status: 'uploading' | 'retrying' | 'done' | 'error' | 'cancelled';
  error?: string;
  file?: File;
  uploadId?: string;
  offset?: number;
  confirmedOffset?: number;
  inFlightLoaded?: number;
  checking?: boolean;
  serverDiag?: ServerChunkDiag | null;
  transport?: string;
  requestPhase?: string;
  batchIndex?: number;
  batchCount?: number;
  batchTotal?: number;
  batchBase?: number;
  batchStartedAt?: number;
}

interface UploadBatch {
  index: number;
  count: number;
  totalBytes: number;
  baseBytes: number;
  startedAt: number;
}

interface UploadQueue {
  files: File[];
  index: number;
  completedBytes: number;
  totalBytes: number;
  startedAt: number;
}

class UploadOffsetError extends Error {
  offset: number;

  constructor(offset: number) {
    super(`服务器已有 ${offset} 字节`);
    this.offset = offset;
  }
}

class UploadCancelledError extends Error {
  constructor() {
    super('已取消');
  }
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  return ext ? ext.slice(0, 4).toUpperCase() : 'FILE';
}

function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function needsSequentialFilePicker(): boolean {
  if (isIosDevice()) return true;
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/(Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Android)/i.test(ua);
}

interface HttpTransferProps {
  lanService?: LanServiceStatus | null;
  networkBlocked?: boolean;
}

export function HttpTransfer({ lanService = null, networkBlocked = false }: HttpTransferProps = {}) {
  const desktop = isTauriHost();
  const publicPaused = lanService?.gate === 'public_blocked' || networkBlocked;
  const serviceUnavailable = desktop && lanService?.running === false && !publicPaused;
  const [pausedError, setPausedError] = useState('');
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    if (serviceUnavailable) setOnline(false);
  }, [serviceUnavailable]);
  const connectionMonitorRef = useRef(new ConnectionMonitor());
  const sseLastEventAtRef = useRef(0);
  const [info, setInfo] = useState<HubInfo | null>(null);
  const [files, setFiles] = useState<HubFile[]>([]);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [savedPaths, setSavedPaths] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<ToastState | null>(null);
  const [activeDownload, setActiveDownload] = useState<ActiveDownload | null>(null);
  const [liveUpload, setLiveUpload] = useState<LiveUpload | null>(null);
  const liveUploadEventAtRef = useRef(0);
  const [sessionCode, setSessionCode] = useState(() => readSessionCode());
  const [token, setToken] = useState(() => readToken());
  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState('');
  const [sessionReady, setSessionReady] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [peerFrame, setPeerFrame] = useState<NearbyPeer | null>(null);
  const [peerState, setPeerState] = useState<'waiting' | 'connected'>('waiting');
  const peerFrameRef = useRef<HTMLIFrameElement>(null);
  const localBrowser = window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1'
    || window.location.hostname === '::1';
  const autoConnect = new URLSearchParams(window.location.search).get('connect') === '1'
    || (!desktop && !localBrowser);

  const inputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [transport, setTransport] = useState<UploadTransport>(() => (isIosDevice() ? 'fetch-blob' : 'xhr-blob'));
  const fetchAbortRef = useRef<AbortController | null>(null);
  const needsPicker = needsSequentialFilePicker();
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const cancelUploadRef = useRef(false);
  const batchQueueRef = useRef<UploadQueue | null>(null);
  const recoveringSessionRef = useRef(false);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // 桌面端通过 loopback /api/session 读取配对码；手机端没有这个权限，只能从链接 #code 或输入框获取。
  // 配对码只用于换取 bearer token，文件 API 不再接受配对码。
  useEffect(() => {
    let alive = true;
    const loadSession = async () => {
      let code = readSessionCode();
      try {
        const response = await fetch(`${API_BASE}/api/session`, { cache: 'no-store' });
        if (response.ok) {
          const data = (await response.json()) as { code?: string };
          if (data.code) code = data.code;
        }
      } catch {
        // 手机/旧版 Hub 没有 /api/session
      }
      if (!alive) return;
      if (code) {
        setSessionCode(code);
        try { window.sessionStorage.setItem(SESSION_STORAGE_KEY, code); } catch { /* ignore */ }
        try {
          const paired = await pairSession(code);
          if (!alive) return;
          setToken(paired.token);
          setCodeError('');
          try { window.sessionStorage.setItem(TOKEN_STORAGE_KEY, paired.token); } catch { /* ignore */ }
        } catch (error) {
          if (!alive) return;
          setToken('');
          setCodeInput(code);
          setCodeError(error instanceof Error ? error.message : '配对失败');
        }
      }
      if (alive) setSessionReady(true);
    };
    void loadSession();
    return () => { alive = false; };
  }, []);

  const handleConnectToken = useCallback((newToken: string, _expiresAt: number) => {
    setToken(newToken);
    setCodeError('');
    setOnline(true);
    setSessionReady(true);
    try { window.sessionStorage.setItem(TOKEN_STORAGE_KEY, newToken); } catch { /* ignore */ }
    setToast({ text: '主机已允许连接', kind: 'success' });
  }, []);

  const localHubAccess = desktop
    || window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';

  // When the LAN gate stops and restarts the Hub, the old bearer token is
  // invalid because the Hub token table is in memory. On a local Hub the
  // session code remains loopback-readable, so re-pair automatically instead
  // of showing a false "authorization expired" page.
  useEffect(() => {
    if (!sessionReady || token || !localHubAccess) return;
    let alive = true;
    const recover = async () => {
      if (recoveringSessionRef.current) return;
      recoveringSessionRef.current = true;
      try {
        const response = await fetch(`${API_BASE}/api/session`, { cache: 'no-store' });
        if (!response.ok) return;
        const data = (await response.json()) as { code?: string };
        if (!data.code || !alive) return;
        const paired = await pairSession(data.code);
        if (!alive) return;
        setSessionCode(data.code);
        setToken(paired.token);
        setCodeError('');
        setOnline(true);
        try {
          window.sessionStorage.setItem(SESSION_STORAGE_KEY, data.code);
          window.sessionStorage.setItem(TOKEN_STORAGE_KEY, paired.token);
        } catch { /* ignore */ }
      } catch {
        // Hub is still stopped or restarting; the next retry will try again.
      } finally {
        recoveringSessionRef.current = false;
      }
    };
    void recover();
    const timer = window.setInterval(() => { void recover(); }, 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [localHubAccess, sessionReady, token]);

  useEffect(() => {
    if (!token || window.parent === window) return;
    try {
      window.parent.postMessage({ type: 'filebridge-peer-connected' }, '*');
    } catch {
      // 跨窗口通知失败不影响传输
    }
  }, [token]);

  useEffect(() => {
    if (!peerFrame) return;
    setPeerState('waiting');
    const expectedOrigin = new URL(peerFrame.url).origin;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== peerFrameRef.current?.contentWindow) return;
      if (event.origin !== expectedOrigin) return;
      if (event.data && event.data.type === 'filebridge-peer-connected') {
        setPeerState('connected');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [peerFrame]);

  useEffect(() => {
    if (!desktop) return;
    let unlisten: UnlistenFn | undefined;
    let disposed = false;

    void listen<DownloadProgressPayload>('download-progress', (event) => {
      const payload = event.payload;
      if (payload.status === 'cancelled' || payload.status === 'failed') return;
      setActiveDownload((prev) => {
        if (!prev || prev.transferId !== payload.transferId) return prev;
        return {
          ...prev,
          loaded: payload.loaded,
          total: payload.total || prev.total,
        };
      });
    })
      .then((dispose) => {
        if (disposed) dispose();
        else unlisten = dispose;
      })
      .catch(() => {
        // 事件监听失败不阻塞下载；命令仍会返回最终结果
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [desktop]);

  const refresh = useCallback(async () => {
    if (!token || !sessionReady) return;
    const monitor = connectionMonitorRef.current;
    if (!monitor.beginProbe()) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_BASE}/api/files`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (response.status === 401) {
        setToken('');
        setCodeError('授权已过期，请重新配对');
        try { window.sessionStorage.removeItem(TOKEN_STORAGE_KEY); } catch { /* ignore */ }
        monitor.completeProbe(true);
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as HubFile[];
      const nextFiles = Array.isArray(data) ? data : [];
      setFiles(nextFiles);
      setSelectedIds((prev) => new Set(
        [...prev].filter((id) => nextFiles.some((file) => file.id === id))
      ));
      const wasOffline = monitor.isOnline === false;
      monitor.completeProbe(true);
      if (wasOffline) sseLastEventAtRef.current = Date.now();
      setOnline(true);
    } catch {
      const outcome = monitor.completeProbe(false);
      if (outcome.changed && outcome.offline) setOnline(false);
    } finally {
      window.clearTimeout(timeout);
    }
  }, [sessionReady, token]);

  useEffect(() => {
    if (!online || !token || !sessionReady) return;
    const source = new EventSource(
      `${API_BASE}/api/events?token=${encodeURIComponent(token)}`
    );
    source.onopen = () => {
      sseLastEventAtRef.current = Date.now();
      connectionMonitorRef.current.noteHeartbeat();
      setOnline(true);
    };
    source.onerror = () => {
      // EventSource reconnects automatically, but do not wait for the user to
      // try an upload. Probe immediately; the heartbeat watchdog will mark the
      // host offline if the stream stays silent.
      sseLastEventAtRef.current = 0;
      void refresh();
    };
    const onHeartbeat = () => {
      sseLastEventAtRef.current = Date.now();
      connectionMonitorRef.current.noteHeartbeat();
    };
    const onUpload = (event: Event) => {
      sseLastEventAtRef.current = Date.now();
      connectionMonitorRef.current.noteHeartbeat();
      try {
        const data = JSON.parse((event as MessageEvent).data) as UploadEventPayload;
        if (data.status === 'started' || data.status === 'progress') {
          liveUploadEventAtRef.current = Date.now();
          setLiveUpload((prev) => ({
            id: data.id,
            name: data.name,
            loaded: data.loaded,
            total: data.total || (prev?.id === data.id ? prev.total : 0),
            startedAt: prev?.id === data.id ? prev.startedAt : Date.now(),
          }));
        } else if (data.status === 'completed') {
          liveUploadEventAtRef.current = 0;
          setLiveUpload(null);
          setToast({ text: `已接收 ${data.name}`, kind: 'success' });
          void refresh();
        } else if (data.status === 'failed') {
          liveUploadEventAtRef.current = 0;
          setLiveUpload(null);
          setToast({ text: `接收失败：${data.name}`, kind: 'error' });
        }
      } catch {
        // 忽略格式不完整的事件
      }
    };
    source.addEventListener('upload', onUpload);
    source.addEventListener('heartbeat', onHeartbeat);
    return () => {
      source.removeEventListener('upload', onUpload);
      source.removeEventListener('heartbeat', onHeartbeat);
      source.close();
    };
  }, [online, sessionReady, token, refresh]);

  useEffect(() => {
    if (!token || !sessionReady || online !== true) return;
    const timer = window.setInterval(() => {
      if (!isHeartbeatStale(sseLastEventAtRef.current, Date.now(), HEARTBEAT_STALE_MS)) return;
      const outcome = connectionMonitorRef.current.heartbeatTimedOut();
      if (outcome.changed) setOnline(false);
      void refresh();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [online, refresh, sessionReady, token]);

  useEffect(() => {
    if (!liveUpload || !upload?.uploadId) return;
    if (liveUpload.id === upload.uploadId) {
      liveUploadEventAtRef.current = 0;
      setLiveUpload(null);
    }
  }, [liveUpload, upload?.uploadId]);

  useEffect(() => {
    if (!upload?.uploadId) return;
    if (upload.status !== 'done' && upload.status !== 'error' && upload.status !== 'cancelled') return;
    setLiveUpload((prev) => {
      if (prev?.id !== upload.uploadId) return prev;
      liveUploadEventAtRef.current = 0;
      return null;
    });
  }, [upload?.status, upload?.uploadId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (liveUploadEventAtRef.current && Date.now() - liveUploadEventAtRef.current > 5000) {
        liveUploadEventAtRef.current = 0;
        setLiveUpload(null);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const loadInfo = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/info`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as HubInfo;
      setInfo(data);
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);

  const openNetworkSettings = useCallback(async () => {
    setPausedError('');
    try {
      await invoke('open_external', { url: 'ms-settings:network-wifi' });
    } catch (reason) {
      setPausedError(`打开网络设置失败：${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }, []);

  // Public pause is a security state, not a service failure. When the gate opens
  // again, re-probe the Hub instead of showing a stale "service unavailable" card.
  useEffect(() => {
    if (publicPaused || !sessionReady || !desktop) return;
    void loadInfo();
  }, [desktop, loadInfo, publicPaused, sessionReady]);

  useEffect(() => {
    if (publicPaused || !desktop || online !== false) return;
    const timer = window.setInterval(() => { void loadInfo(); }, 3000);
    return () => window.clearInterval(timer);
  }, [desktop, loadInfo, online, publicPaused]);

  const unlock = useCallback(async () => {
    const candidate = codeInput.trim();
    if (!/^\d{6}$/.test(candidate)) {
      setCodeError('请输入电脑上显示的 6 位数字配对码');
      return;
    }
    setCodeError('');
    try {
      const paired = await pairSession(candidate);
      const response = await fetch(`${API_BASE}/api/files`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${paired.token}` },
      });
      if (!response.ok) throw new Error('配对成功，但读取文件列表失败，请重试');
      const data = (await response.json()) as HubFile[];
      setFiles(Array.isArray(data) ? data : []);
      setSessionCode(candidate);
      setToken(paired.token);
      setCodeInput('');
      try {
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, candidate);
        window.sessionStorage.setItem(TOKEN_STORAGE_KEY, paired.token);
      } catch { /* ignore */ }
      setOnline(true);
    } catch (e) {
      setCodeError(e instanceof Error ? e.message : '连接失败');
    }
  }, [codeInput]);

  const rotatePairing = useCallback(async () => {
    if (!window.confirm('重新生成配对码会使所有手机连接失效，确定继续？')) return;
    setRotating(true);
    setCodeError('');
    try {
      const response = await fetch(`${API_BASE}/api/session/rotate`, { method: 'POST' });
      if (response.status === 403) {
        throw new Error('只有电脑本机可以重新生成配对码');
      }
      if (!response.ok) throw new Error('重新生成失败，请确认 Hub 正常运行');
      const data = (await response.json()) as { code: string };
      const paired = await pairSession(data.code);
      setSessionCode(data.code);
      setToken(paired.token);
      setCodeInput('');
      setFiles([]);
      try {
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, data.code);
        window.sessionStorage.setItem(TOKEN_STORAGE_KEY, paired.token);
      } catch { /* ignore */ }
    } catch (e) {
      setCodeError(e instanceof Error ? e.message : '重新生成失败');
    } finally {
      setRotating(false);
    }
  }, []);

  useEffect(() => {
    void loadInfo();
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [loadInfo, refresh]);

  const queryUploadOffset = useCallback(async (id: string): Promise<{ offset: number; complete: boolean; file?: HubFile; diagnostics?: ServerChunkDiag | null }> => {
    const response = await fetch(`${API_BASE}/api/upload/chunk/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('无法核对服务器已保存进度');
    const data = (await response.json()) as { offset?: number; complete?: boolean; file?: HubFile; diagnostics?: ServerChunkDiag | null };
    return {
      offset: Number(data.offset || 0),
      complete: Boolean(data.complete),
      file: data.file,
      diagnostics: data.diagnostics ?? null,
    };
  }, [token]);

  const uploadChunk = useCallback((file: File, id: string, offset: number): Promise<{
    offset: number;
    complete: boolean;
    file?: HubFile;
  }> => {
    if (!token) return Promise.reject(new Error('缺少访问授权'));
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      setUpload((prev) => prev ? { ...prev, requestPhase: 'created' } : prev);
      const chunkSize = isIosDevice() ? IOS_UPLOAD_CHUNK_SIZE : UPLOAD_CHUNK_SIZE;
      const end = Math.min(offset + chunkSize, file.size);
      const chunk = file.slice(offset, end);
      xhr.open('POST', `${API_BASE}/api/upload/chunk?name=${encodeURIComponent(file.name)}&id=${encodeURIComponent(id)}&offset=${offset}&total=${file.size}`);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.timeout = UPLOAD_CHUNK_TIMEOUT_MS;

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const inFlight = Math.min(file.size, offset + event.loaded);
        setUpload((prev) => prev ? {
          ...prev,
          loaded: inFlight,
          inFlightLoaded: inFlight,
          total: file.size,
        } : prev);
      };

      xhr.upload.onload = () => {
        setUpload((prev) => prev ? { ...prev, requestPhase: 'upload-complete' } : prev);
      };

      xhr.onload = () => {
        xhrRef.current = null;
        setUpload((prev) => prev ? { ...prev, requestPhase: 'response-received', loaded: Math.max(prev.loaded, end), inFlightLoaded: Math.max(prev.inFlightLoaded || 0, end) } : prev);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as { offset: number; complete: boolean; file?: HubFile });
          } catch {
            reject(new Error('服务器返回了无效 JSON'));
          }
          return;
        }
        if (xhr.status === 401) {
          setToken('');
          setCodeError('授权已过期，请重新配对');
          try { window.sessionStorage.removeItem(TOKEN_STORAGE_KEY); } catch { /* ignore */ }
        }
        if (xhr.status === 409) {
          try {
            const parsed = JSON.parse(xhr.responseText) as { offset?: number };
            reject(new UploadOffsetError(Number(parsed.offset || 0)));
            return;
          } catch {
            // fall through to a normal retryable error
          }
        }
        let message = xhr.status === 413
          ? '文件超过 Hub 限制'
          : '上传中断，可继续上传';
        try {
          const parsed = JSON.parse(xhr.responseText);
          if (parsed?.error) message = parsed.error;
        } catch {
          // ignore
        }
        reject(new Error(message));
      };

      xhr.onerror = () => {
        xhrRef.current = null;
        reject(new Error('网络中断，进度已保留，可继续上传'));
      };
      xhr.ontimeout = () => {
        xhrRef.current = null;
        reject(new Error('上传分块超时，进度已保留，可继续上传'));
      };
      xhr.onabort = () => {
        xhrRef.current = null;
        reject(new UploadCancelledError());
      };

      xhrRef.current = xhr;
      xhr.send(chunk);
    });
  }, [token]);

  const uploadChunkFetch = useCallback(async (file: File, id: string, offset: number): Promise<{
    offset: number;
    complete: boolean;
    file?: HubFile;
  }> => {
    const chunkSize = isIosDevice() ? IOS_UPLOAD_CHUNK_SIZE : UPLOAD_CHUNK_SIZE;
    const end = Math.min(offset + chunkSize, file.size);
    const chunk = file.slice(offset, end);
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    setUpload((prev) => prev ? {
      ...prev,
      requestPhase: 'uploading',
    } : prev);
    const timeout = window.setTimeout(() => controller.abort(), UPLOAD_CHUNK_TIMEOUT_MS);
    try {
      const response = await fetch(
        `${API_BASE}/api/upload/chunk?name=${encodeURIComponent(file.name)}&id=${encodeURIComponent(id)}&offset=${offset}&total=${file.size}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            Authorization: `Bearer ${token}`,
          },
          body: chunk,
          signal: controller.signal,
          cache: 'no-store',
        },
      );
      setUpload((prev) => prev ? { ...prev, requestPhase: 'response-received', loaded: Math.max(prev.loaded, end), inFlightLoaded: Math.max(prev.inFlightLoaded || 0, end) } : prev);
      // iOS WebKit can deliver the response headers but stall while reading the
      // response body. Do not depend on the body; reconcile through the status GET.
      await response.body?.cancel().catch(() => {});
      if (response.status === 409) {
        const status = await queryUploadOffset(id);
        throw new UploadOffsetError(status.offset);
      }
      if (!response.ok) {
        throw new Error(response.status === 413 ? '文件超过 Hub 限制' : '上传中断，可继续上传');
      }
      const status = await queryUploadOffset(id);
      return {
        offset: status.offset,
        complete: status.complete,
        file: status.file,
      };
    } finally {
      window.clearTimeout(timeout);
      fetchAbortRef.current = null;
    }
  }, [queryUploadOffset, token]);

  const uploadFile = useCallback(async (
    file: File,
    resume?: { id: string; offset: number },
    batch?: UploadBatch,
  ): Promise<HubFile> => {
    const id = resume?.id || makeTransferId();
    let confirmedOffset = resume?.offset || 0;
    let offset = confirmedOffset;
    cancelUploadRef.current = false;
    setUpload({
      name: file.name,
      loaded: confirmedOffset,
      total: file.size,
      startedAt: batch?.startedAt || Date.now(),
      status: 'uploading',
      file,
      uploadId: id,
      offset: confirmedOffset,
      confirmedOffset,
      inFlightLoaded: confirmedOffset,
      checking: false,
      serverDiag: null,
      batchIndex: batch?.index,
      batchCount: batch?.count,
      batchTotal: batch?.totalBytes,
      batchBase: batch?.baseBytes ?? 0,
      batchStartedAt: batch?.startedAt,
    });

    while (offset <= file.size) {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (cancelUploadRef.current) throw new UploadCancelledError();
        try {
          const result = transport === 'fetch-blob'
            ? await uploadChunkFetch(file, id, offset)
            : await uploadChunk(file, id, offset);
          if (result.complete && result.file) {
            setUpload((prev) => prev ? {
              ...prev,
              loaded: result.offset,
              inFlightLoaded: result.offset,
              confirmedOffset: result.offset,
              offset: result.offset,
              status: 'uploading',
            } : prev);
            return result.file;
          }
          confirmedOffset = result.offset;
          offset = result.offset;
          setUpload((prev) => prev ? {
            ...prev,
            offset,
            confirmedOffset,
            loaded: confirmedOffset,
            inFlightLoaded: confirmedOffset,
            status: 'uploading',
            checking: false,
          } : prev);
          lastError = null;
          break;
        } catch (reason) {
          if (reason instanceof UploadCancelledError) throw reason;
          lastError = reason;

          // Always reconcile with the server after a failed chunk. The browser's
          // upload progress is only "sent", never "saved".
          let serverStatus: { offset: number; complete: boolean; file?: HubFile; diagnostics?: ServerChunkDiag | null } | null = null;
          try {
            serverStatus = await queryUploadOffset(id);
          } catch {
            // Keep the last confirmed offset; never promote in-flight bytes.
          }
          if (serverStatus?.complete && serverStatus.file) {
            setUpload((prev) => prev ? {
              ...prev,
              loaded: serverStatus!.offset,
              inFlightLoaded: serverStatus!.offset,
              confirmedOffset: serverStatus!.offset,
              offset: serverStatus!.offset,
              status: 'uploading',
            } : prev);
            return serverStatus.file;
          }
          if (serverStatus) {
            confirmedOffset = serverStatus.offset;
            offset = serverStatus.offset;
            setUpload((prev) => prev ? {
              ...prev,
              confirmedOffset,
              offset,
              serverDiag: serverStatus.diagnostics ?? prev.serverDiag,
              status: 'retrying',
              checking: false,
            } : prev);
          } else if (reason instanceof UploadOffsetError) {
            confirmedOffset = reason.offset;
            offset = reason.offset;
            setUpload((prev) => prev ? {
              ...prev,
              confirmedOffset,
              offset,
              status: 'retrying',
              checking: false,
            } : prev);
          } else {
            setUpload((prev) => prev ? {
              ...prev,
              status: 'retrying',
              checking: false,
            } : prev);
          }
          if (attempt < 3) {
            await new Promise((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)));
          }
        }
      }
      if (lastError) {
        if (cancelUploadRef.current) throw new UploadCancelledError();
        const message = lastError instanceof Error ? lastError.message : String(lastError);
        setUpload((prev) => prev ? {
          ...prev,
          status: 'error',
          offset,
          confirmedOffset,
          checking: false,
          error: message,
        } : prev);
        throw lastError;
      }
      if (offset >= file.size) {
        try {
          const status = await queryUploadOffset(id);
          if (status.complete && status.file) {
            setUpload((prev) => prev ? {
              ...prev,
              loaded: status.offset,
              inFlightLoaded: status.offset,
              confirmedOffset: status.offset,
              offset: status.offset,
            } : prev);
            return status.file;
          }
        } catch {
          // fall through to a normal retry
        }
        if (offset === file.size) {
          // Retry the final zero-length chunk so a lost completion response can finalize.
          const result = transport === 'fetch-blob'
            ? await uploadChunkFetch(file, id, offset)
            : await uploadChunk(file, id, offset);
          if (result.complete && result.file) return result.file;
        }
      }
    }
    throw new Error('上传未完成');
  }, [queryUploadOffset, transport, uploadChunk, uploadChunkFetch]);

  const uploadBatch = useCallback(async (
    files: File[],
    startIndex = 0,
    completedBefore = 0,
    resumeCurrent?: { id: string; offset: number },
  ) => {
    if (files.length === 0) return;
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    const startedAt = batchQueueRef.current?.startedAt || Date.now();
    let completedBytes = completedBefore;
    batchQueueRef.current = {
      files,
      index: startIndex,
      completedBytes,
      totalBytes,
      startedAt,
    };
    setError('');

    for (let index = startIndex; index < files.length; index += 1) {
      const file = files[index];
      const resume = index === startIndex ? resumeCurrent : undefined;
      try {
        const saved = await uploadFile(file, resume, {
          index: index + 1,
          count: files.length,
          totalBytes,
          baseBytes: completedBytes,
          startedAt,
        });
        completedBytes += saved.size;
        batchQueueRef.current = {
          files,
          index: index + 1,
          completedBytes,
          totalBytes,
          startedAt,
        };
      } catch (reason) {
        if (reason instanceof UploadCancelledError) {
          batchQueueRef.current = null;
          setUpload((prev) => prev ? { ...prev, status: 'cancelled', error: undefined } : prev);
          setError('');
        } else {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
        return;
      }
    }

    batchQueueRef.current = null;
    setUpload((prev) => prev ? {
      ...prev,
      loaded: prev.file?.size || prev.loaded,
      inFlightLoaded: prev.file?.size || prev.inFlightLoaded,
      total: prev.file?.size || prev.total,
      status: 'done',
      offset: prev.file?.size || prev.offset,
      confirmedOffset: prev.file?.size || prev.confirmedOffset,
    } : prev);
    await refresh();
  }, [refresh, uploadFile]);

  useEffect(() => {
    if (!upload?.uploadId) return;
    if (upload.status !== 'uploading' && upload.status !== 'retrying') return;
    const uploadId = upload.uploadId;
    const timer = window.setInterval(() => {
      void queryUploadOffset(uploadId).then((status) => {
        setUpload((prev) => prev && prev.uploadId === uploadId ? {
          ...prev,
          serverDiag: status.diagnostics ?? prev.serverDiag,
        } : prev);
      }).catch(() => { /* network down; keep the last diagnostic */ });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [queryUploadOffset, upload?.uploadId, upload?.status]);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const selected = Array.from(fileList);
    if (selected.length === 0) return;
    if (online === false) {
      setError(desktop
        ? 'HTTP Hub 未启动，请先确认电脑端服务在线'
        : '主机服务不可用，主机可能已切换到公用网络或关闭了应用');
      return;
    }
    await uploadBatch(selected);
  }, [desktop, online, uploadBatch]);

  const selectFiles = useCallback((fileList: FileList | File[]) => {
    const selected = Array.from(fileList);
    if (selected.length === 0) return;
    if (online === false) {
      setError(desktop
        ? 'HTTP Hub 未启动，请先确认电脑端服务在线'
        : '主机服务不可用，主机可能已切换到公用网络或关闭了应用');
      return;
    }
    if (needsPicker && (selected.length === 1 || pendingFiles.length > 0)) {
      setPendingFiles((prev) => [...prev, ...selected]);
      setError('');
      return;
    }
    void handleFiles(selected);
  }, [desktop, handleFiles, needsPicker, online, pendingFiles.length]);

  const uploadPending = useCallback(() => {
    if (pendingFiles.length === 0) return;
    const selected = pendingFiles;
    setPendingFiles([]);
    void handleFiles(selected);
  }, [handleFiles, pendingFiles]);

  const resumeUpload = useCallback(() => {
    if (!upload?.file || !upload.uploadId) return;
    cancelUploadRef.current = false;
    const file = upload.file;
    const uploadId = upload.uploadId;
    const queue = batchQueueRef.current;
    setUpload((prev) => prev ? {
      ...prev,
      status: 'retrying',
      checking: true,
      error: undefined,
    } : prev);

    void (async () => {
      let status: { offset: number; complete: boolean; file?: HubFile; diagnostics?: ServerChunkDiag | null };
      try {
        status = await queryUploadOffset(uploadId);
      } catch {
        const message = '无法核对服务器已保存进度，请检查连接后重试';
        setUpload((prev) => prev ? {
          ...prev,
          status: 'error',
          checking: false,
          error: message,
        } : prev);
        setError(message);
        return;
      }
      if (hasServerFile(status)) {
        const doneOffset = status.offset;
        if (queue && upload.file) {
          const nextCompleted = queue.completedBytes + upload.file.size;
          const nextIndex = queue.index + 1;
          batchQueueRef.current = {
            ...queue,
            index: nextIndex,
            completedBytes: nextCompleted,
          };
          if (nextIndex < queue.files.length) {
            setUpload((prev) => prev ? {
              ...prev,
              loaded: upload.file!.size,
              inFlightLoaded: upload.file!.size,
              confirmedOffset: upload.file!.size,
              offset: upload.file!.size,
              status: 'uploading',
              checking: false,
            } : prev);
            await uploadBatch(queue.files, nextIndex, nextCompleted);
            return;
          }
          batchQueueRef.current = null;
        }
        setUpload((prev) => prev ? {
          ...prev,
          loaded: doneOffset,
          inFlightLoaded: doneOffset,
          confirmedOffset: doneOffset,
          offset: doneOffset,
          status: 'done',
          checking: false,
        } : prev);
        await refresh();
        return;
      }

      const confirmed = resolveServerOffset({
        confirmedOffset: upload.confirmedOffset ?? upload.offset ?? 0,
        inFlightLoaded: upload.inFlightLoaded ?? upload.loaded ?? 0,
      }, status).confirmedOffset;
      setUpload((prev) => prev ? {
        ...prev,
        confirmedOffset: confirmed,
        offset: confirmed,
        loaded: confirmed,
        inFlightLoaded: confirmed,
        serverDiag: status.diagnostics ?? prev.serverDiag,
        checking: false,
      } : prev);

      if (queue) {
        await uploadBatch(
          queue.files,
          queue.index,
          queue.completedBytes,
          { id: uploadId, offset: confirmed },
        );
        return;
      }
      const batch = upload.batchCount ? {
        index: upload.batchIndex || 1,
        count: upload.batchCount,
        totalBytes: upload.batchTotal || upload.total,
        baseBytes: upload.batchBase || 0,
        startedAt: upload.batchStartedAt || upload.startedAt,
      } : undefined;
      try {
        const saved = await uploadFile(file, { id: uploadId, offset: confirmed }, batch);
        setUpload((prev) => prev ? {
          ...prev,
          loaded: saved.size,
          inFlightLoaded: saved.size,
          total: saved.size,
          status: 'done',
          offset: saved.size,
          confirmedOffset: saved.size,
        } : prev);
        await refresh();
      } catch {
        // upload state carries the failure
      }
    })();
  }, [queryUploadOffset, refresh, upload, uploadBatch, uploadFile]);

  const cancelUpload = useCallback(() => {
    cancelUploadRef.current = true;
    batchQueueRef.current = null;
    fetchAbortRef.current?.abort();
    xhrRef.current?.abort();
    const id = upload?.uploadId;
    if (id && token) {
      void fetch(`${API_BASE}/api/upload/chunk/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    setUpload((prev) => prev ? { ...prev, status: 'cancelled', error: undefined } : prev);
  }, [token, upload?.uploadId]);

  const deleteFile = useCallback(async (id: string) => {
    if (!window.confirm('确定从电脑上删除这个文件？')) return;
    try {
      const response = await fetch(`${API_BASE}/api/files/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) {
        setToken('');
        setCodeError('授权已过期，请在“连接详情”里重新配对');
        return;
      }
      if (!response.ok) throw new Error('删除失败，请稍后重试');
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败，请稍后重试');
    }
  }, [refresh, token]);

  const deleteSelected = useCallback(async () => {
    if (batchDeleting || batchSaving || selectedIds.size === 0) return;
    const targets = files.filter((file) => selectedIds.has(file.id));
    if (targets.length === 0) return;
    if (!window.confirm(`确定从电脑上删除 ${targets.length} 个文件？此操作不可恢复。`)) return;

    setBatchDeleting(true);
    let removed = 0;
    try {
      for (const file of targets) {
        const response = await fetch(`${API_BASE}/api/files/${file.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.status === 401) {
          setToken('');
          setCodeError('授权已过期，请在“连接详情”里重新配对');
          return;
        }
        if (!response.ok) throw new Error(`删除 ${file.name} 失败`);
        removed += 1;
      }
      setSelectedIds(new Set());
      setToast({ text: `已删除 ${removed}/${targets.length} 个文件`, kind: 'success' });
      await refresh();
    } catch (reason) {
      setToast({
        text: reason instanceof Error ? reason.message : '批量删除失败',
        kind: 'error',
      });
      await refresh();
    } finally {
      setBatchDeleting(false);
    }
  }, [batchDeleting, batchSaving, files, refresh, selectedIds, token]);

  const openPath = useCallback((path: string) => {    if (!desktop) return;
    void invoke('open_path', { path }).catch((reason) => {
      setToast({ text: `打开文件夹失败：${String(reason)}`, kind: 'error' });
    });
  }, [desktop]);

  const openDownloadDir = useCallback(() => {
    if (!desktop) return;
    void invoke('open_download_dir').catch((reason) => {
      setToast({ text: `打开下载文件夹失败：${String(reason)}`, kind: 'error' });
    });
  }, [desktop]);

  const saveOne = useCallback(async (file: HubFile) => {
    if (!desktop) return;
    const transferId = makeTransferId();
    setActiveDownload({
      transferId,
      name: file.name,
      loaded: 0,
      total: file.size,
      startedAt: Date.now(),
      status: 'copying',
    });
    setSavingId(file.id);
    try {
      const result = await invoke<SavedFile>('save_download', { id: file.id, transferId });
      setSavedPaths((prev) => ({ ...prev, [file.id]: result.path }));
      return { result };
    } catch (reason) {
      const message = String(reason);
      if (message.includes('已取消')) {
        throw new Error('已取消保存');
      }
      throw new Error(`保存失败：${message}`);
    } finally {
      setSavingId(null);
      setActiveDownload(null);
    }
  }, [desktop]);

  const saveDownload = useCallback(async (file: HubFile) => {
    if (!desktop || savingId || batchSaving || batchDeleting) return;
    try {
      const outcome = await saveOne(file);
      if (outcome?.result) {
        setToast({
          text: outcome.result.existed
            ? `文件已存在，未重复保存：${outcome.result.path}`
            : `下载完成：${outcome.result.path}`,
          kind: 'success',
          path: outcome.result.path,
        });
      }
    } catch (reason) {
      setToast({
        text: reason instanceof Error ? reason.message : String(reason),
        kind: reason instanceof Error && reason.message === '已取消保存' ? 'info' : 'error',
      });
    }
  }, [desktop, savingId, batchSaving, batchDeleting, saveOne]);

  const saveSelected = useCallback(async () => {
    if (savingId || batchSaving || batchDeleting) return;
    const targets = files.filter((file) => selectedIds.has(file.id));
    if (targets.length === 0) return;

    if (!desktop) {
      targets.forEach((file, index) => {
        window.setTimeout(() => {
          const anchor = document.createElement('a');
          anchor.href = `${API_BASE}/api/files/${file.id}?token=${encodeURIComponent(token)}`;
          anchor.download = file.name;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
        }, index * 350);
      });
      setToast({ text: `已开始下载 ${targets.length} 个文件，请查看浏览器下载列表`, kind: 'info' });
      return;
    }

    setBatchSaving(true);
    let completed = 0;
    try {
      for (const file of targets) {
        const outcome = await saveOne(file);
        if (outcome?.result.path) completed += 1;
      }
      setToast({ text: `已保存 ${completed}/${targets.length} 个文件`, kind: 'success' });
    } catch (reason) {
      setToast({ text: String(reason instanceof Error ? reason.message : reason), kind: 'error' });
    } finally {
      setBatchSaving(false);
    }
  }, [batchSaving, batchDeleting, desktop, files, saveOne, savingId, selectedIds, token]);

  const cancelDownload = useCallback(() => {
    if (!activeDownload || activeDownload.status === 'cancelling') return;
    const { transferId } = activeDownload;
    setActiveDownload((prev) => (prev ? { ...prev, status: 'cancelling' } : prev));
    void invoke('cancel_download', { transferId }).catch((reason) => {
      setToast({ text: `取消失败：${String(reason)}`, kind: 'error' });
    });
  }, [activeDownload]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const all = files.length > 0 && files.every((file) => prev.has(file.id));
      return all ? new Set() : new Set(files.map((file) => file.id));
    });
  }, [files]);

  const phoneBase = resolvePhoneBase(info);
  const phoneUrl = phoneBase && sessionCode
    ? `${phoneBase}/#code=${encodeURIComponent(sessionCode)}`
    : '';
  const isViteDev = window.location.port === '5173';
  const uploadTotalBytes = upload?.batchTotal ?? upload?.total ?? 0;
  const uploadConfirmedOffset = upload?.confirmedOffset ?? upload?.offset ?? 0;
  const uploadInFlightOffset = upload?.inFlightLoaded ?? upload?.loaded ?? uploadConfirmedOffset;
  const uploadLoadedBytes = upload
    ? Math.min(uploadTotalBytes, (upload.batchBase || 0) + uploadConfirmedOffset)
    : 0;
  const uploadInFlightBytes = upload
    ? Math.min(uploadTotalBytes, (upload.batchBase || 0) + uploadInFlightOffset)
    : 0;
  const uploadIsBatch = Boolean(upload && (upload.batchCount || 1) > 1);
  const uploadPercent = uploadTotalBytes > 0
    ? confirmedPercent(uploadLoadedBytes, uploadTotalBytes)
    : (upload?.status === 'done' ? 100 : 0);
  const uploadElapsed = upload && (upload.status === 'uploading' || upload.status === 'retrying')
    ? Math.max(0.001, (Date.now() - (upload.batchStartedAt || upload.startedAt)) / 1000)
    : 0;
  const uploadSpeed = uploadElapsed > 0 ? uploadInFlightBytes / uploadElapsed : 0;
  const uploadEta = uploadSpeed > 0 ? Math.max(0, (uploadTotalBytes - uploadLoadedBytes) / uploadSpeed) : 0;
  const uploadDiagnostic = upload ? {
    mode: transport,
    chunkBytes: isIosDevice() ? IOS_UPLOAD_CHUNK_SIZE : UPLOAD_CHUNK_SIZE,
    fileSize: upload.total,
    batchIndex: upload.batchIndex,
    batchCount: upload.batchCount,
    browserSent: uploadInFlightBytes,
    requestPhase: upload.requestPhase ?? null,
    serverConfirmed: uploadLoadedBytes,
    serverBodyRead: upload.serverDiag?.bodyRead ?? null,
    serverPartSize: upload.serverDiag?.partSize ?? null,
    serverBodyState: upload.serverDiag?.bodyState ?? null,
    serverLastError: upload.serverDiag?.lastError ?? null,
    contentLength: upload.serverDiag?.contentLength ?? null,
    transferEncoding: upload.serverDiag?.transferEncoding ?? null,
    expect: upload.serverDiag?.expect ?? null,
    serverStatusCode: upload.serverDiag?.statusCode ?? null,
    durationMs: upload.serverDiag?.durationMs ?? null,
    status: upload.status,
    error: upload.error ?? null,
  } : null;
  const downloadPercent = activeDownload
    ? (activeDownload.total > 0
      ? Math.min(100, Math.round((activeDownload.loaded / activeDownload.total) * 100))
      : (activeDownload.loaded > 0 ? 100 : 0))
    : 0;
  const downloadElapsed = activeDownload
    ? Math.max(0.001, (Date.now() - activeDownload.startedAt) / 1000)
    : 0;
  const downloadSpeed = activeDownload && downloadElapsed > 0
    ? activeDownload.loaded / downloadElapsed
    : 0;
  const downloadEta = activeDownload && downloadSpeed > 0
    ? Math.max(0, (activeDownload.total - activeDownload.loaded) / downloadSpeed)
    : 0;
  const visibleLiveUpload = shouldShowLiveUpload(upload?.uploadId, liveUpload?.id)
    ? liveUpload
    : null;
  const showLiveUpload = Boolean(visibleLiveUpload);
  const livePercent = visibleLiveUpload
    ? (visibleLiveUpload.total > 0
      ? Math.min(100, Math.round((visibleLiveUpload.loaded / visibleLiveUpload.total) * 100))
      : (visibleLiveUpload.loaded > 0 ? 100 : 0))
    : 0;
  const liveElapsed = visibleLiveUpload
    ? Math.max(0.001, (Date.now() - visibleLiveUpload.startedAt) / 1000)
    : 0;
  const liveSpeed = visibleLiveUpload && liveElapsed > 0 ? visibleLiveUpload.loaded / liveElapsed : 0;
  const liveEta = visibleLiveUpload && liveSpeed > 0
    ? Math.max(0, (visibleLiveUpload.total - visibleLiveUpload.loaded) / liveSpeed)
    : 0;

  const effectiveUploadSpeed = upload && (upload.status === 'uploading' || upload.status === 'retrying')
    ? Math.max(uploadSpeed, showLiveUpload ? liveSpeed : 0)
    : showLiveUpload
      ? liveSpeed
      : 0;
  const effectiveDownloadSpeed = activeDownload ? downloadSpeed : 0;
  const hasActiveTransfer = Boolean(upload || visibleLiveUpload || activeDownload);
  const [uploadPeak, setUploadPeak] = useState(0);
  const [downloadPeak, setDownloadPeak] = useState(0);
  const [uploadHistory, setUploadHistory] = useState<number[]>(() => Array(24).fill(0));
  const [downloadHistory, setDownloadHistory] = useState<number[]>(() => Array(24).fill(0));
  const [uploadTotal, setUploadTotal] = useState(0);
  const [downloadTotal, setDownloadTotal] = useState(0);
  const uploadSpeedRef = useRef(0);
  const downloadSpeedRef = useRef(0);
  const uploadMeterRef = useRef<{ key: number; loaded: number }>({ key: -1, loaded: 0 });
  const liveMeterRef = useRef<{ key: string; loaded: number }>({ key: '', loaded: 0 });
  const downloadMeterRef = useRef<{ key: string; loaded: number }>({ key: '', loaded: 0 });
  uploadSpeedRef.current = effectiveUploadSpeed;
  downloadSpeedRef.current = effectiveDownloadSpeed;

  useEffect(() => {
    if (!upload) return;
    if (uploadMeterRef.current.key !== upload.startedAt) {
      uploadMeterRef.current = { key: upload.startedAt, loaded: 0 };
    }
    const delta = Math.max(0, upload.loaded - uploadMeterRef.current.loaded);
    if (delta > 0) setUploadTotal((value) => value + delta);
    uploadMeterRef.current.loaded = upload.loaded;
  }, [upload]);

  useEffect(() => {
    if (!visibleLiveUpload || (upload && upload.status === 'uploading')) return;
    if (liveMeterRef.current.key !== visibleLiveUpload.id) {
      liveMeterRef.current = { key: visibleLiveUpload.id, loaded: 0 };
    }
    const delta = Math.max(0, visibleLiveUpload.loaded - liveMeterRef.current.loaded);
    if (delta > 0) setUploadTotal((value) => value + delta);
    liveMeterRef.current.loaded = visibleLiveUpload.loaded;
  }, [visibleLiveUpload, upload]);

  useEffect(() => {
    if (!activeDownload) return;
    if (downloadMeterRef.current.key !== activeDownload.transferId) {
      downloadMeterRef.current = { key: activeDownload.transferId, loaded: 0 };
    }
    const delta = Math.max(0, activeDownload.loaded - downloadMeterRef.current.loaded);
    if (delta > 0) setDownloadTotal((value) => value + delta);
    downloadMeterRef.current.loaded = activeDownload.loaded;
  }, [activeDownload]);

  useEffect(() => {
    if (effectiveUploadSpeed > 0) {
      setUploadPeak((value) => Math.max(value, effectiveUploadSpeed));
      setUploadHistory((values) => [...values.slice(-23), effectiveUploadSpeed]);
    }
  }, [effectiveUploadSpeed]);

  useEffect(() => {
    if (effectiveDownloadSpeed > 0) {
      setDownloadPeak((value) => Math.max(value, effectiveDownloadSpeed));
      setDownloadHistory((values) => [...values.slice(-23), effectiveDownloadSpeed]);
    }
  }, [effectiveDownloadSpeed]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const up = uploadSpeedRef.current;
      const down = downloadSpeedRef.current;
      setUploadPeak((value) => Math.max(value, up));
      setDownloadPeak((value) => Math.max(value, down));
      setUploadHistory((values) => [...values.slice(-23), up]);
      setDownloadHistory((values) => [...values.slice(-23), down]);
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  const allSelected = files.length > 0 && files.every((file) => selectedIds.has(file.id));

  const pairingLabel = token
    ? '已配对'
    : codeError
      ? '授权已过期'
      : '未配对';
  const canRotate = desktop
    || window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  const statusLabel = publicPaused
    ? '网络暂停'
    : !sessionReady
      ? '读取中'
      : online === null
        ? '连接中'
        : online === false
          ? (desktop ? '服务异常' : '无法连接')
          : !token
            ? (codeError ? '授权已过期' : '需要配对')
            : '在线';
  const statusClass = statusLabel === '在线'
    ? 'chip-ok'
    : statusLabel === '网络暂停'
      ? 'chip-warn'
      : statusLabel === '服务异常'
        || statusLabel === '无法连接'
        || statusLabel === '授权已过期'
        ? 'chip-bad'
        : 'chip-warn';

  const pairingDetails = (
    <details className="pairing-details" open={!token || undefined}>
      <summary>
        手动连接 / 连接详情
        <span className={`pairing-state${token ? ' ok' : ''}`}>{pairingLabel}</span>
      </summary>
      <div className="pairing-body">
        {sessionCode && (
          <div className="pairing-code-row">
            <span>配对码</span>
            <strong>{sessionCode}</strong>
            <CopyButton text={sessionCode} label="复制配对码" />
          </div>
        )}
        <label className="field-label" htmlFor="http-session-code">手动输入配对码</label>
        <div className="path-row">
          <input
            id="http-session-code"
            className="input"
            value={codeInput}
            onChange={(event) => setCodeInput(event.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(event) => { if (event.key === 'Enter') void unlock(); }}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="6 位数字"
            style={{ textAlign: 'center', fontSize: '1.2rem', letterSpacing: 4 }}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void unlock()}
            disabled={codeInput.length !== 6 || rotating}
          >
            连接
          </button>
        </div>
        {canRotate && (
          <button
            type="button"
            className="btn btn-small"
            onClick={() => void rotatePairing()}
            disabled={rotating}
          >
            {rotating ? '生成中…' : '重新生成配对码'}
          </button>
        )}
        {codeError && <p className="text-error" role="alert">{codeError}</p>}
        <p className="hint">
          扫码成功时无需手动操作；配对码只用于换取 12 小时访问授权。
        </p>
      </div>
    </details>
  );

  const serviceNotice = desktop && online === false && !publicPaused ? (
    <div className="notice notice-bad">
      <p>
        {desktop
          ? lanService?.running === false
            ? (lanService.detail || '局域网服务未能启动。请检查 TCP 42080 / UDP 42081 是否被占用，或查看下方发现状态后重试。')
            : '电脑端局域网服务异常，暂时无法访问文件页。请重试连接。'
          : '无法连接电脑端服务。请确认运行 Filebridge-Lan 的电脑已启动，并与当前设备在同一局域网。'}
      </p>
      <button
        type="button"
        className="btn btn-small"
        onClick={() => {
          setOnline(null);
          void loadInfo();
          void refresh();
        }}
      >
        重试连接
      </button>
    </div>
  ) : null;

  if (publicPaused) {
    return (
      <div className="lan-dashboard">
        <article className="card lan-paused-card">
          <h2>当前网络为公用网络，局域网传输服务已暂停。</h2>
          <p className="lan-paused-copy">
            切换到专用网络后将自动恢复，不会在 Public 网络开放 42080/42081。
          </p>
          <div className="lan-paused-meta">
            <span className={`status-pill ${token ? 'warn' : 'warn'}`}>
              {token ? '已配对 · 当前不可连接' : '未配对 · 当前不可连接'}
            </span>
          </div>
          <div className="lan-paused-actions">
            <button type="button" className="btn btn-primary" onClick={() => void openNetworkSettings()}>
              前往网络设置
            </button>
          </div>
          {pausedError && <p className="text-error" role="alert">{pausedError}</p>}
          <p className="hint">
            局域网 IP、扫码和手动配对码仅在专用网络下可用。
          </p>
        </article>
      </div>
    );
  }

  if (!sessionReady) {
    return (
      <div className="lan-dashboard">
        <article className="card loading-card">
          <span className="loading-dot" />
          <div>
            <h2>正在读取连接状态</h2>
            <p>稍等片刻，正在确认本机 Hub 和配对状态。</p>
          </div>
        </article>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="lan-dashboard">
        <div className="dashboard-grid single">
          <article className="card connection-card">
            <div className="card-head">
              <div>
                <h2>
                  连接这台电脑
                  <InfoTip text="扫码通常会自动配对；失败时可手动输入 6 位配对码。也可以直接请求主机确认，无需输入配对码。" />
                </h2>
              </div>
              <span className={`status-pill ${codeError ? 'danger' : 'warn'}`}>
                {codeError ? '授权已过期' : '需要配对'}
              </span>
            </div>
            {serviceNotice}
            <ConnectPanel autoConnect={autoConnect} onConnected={handleConnectToken} />
            {pairingDetails}
          </article>
        </div>
      </div>
    );
  }

  return (
    <div className={`lan-dashboard${desktop ? ' has-nearby' : ''}`}>
      {!desktop && online === false && (
        <div className="notice notice-bad remote-offline" role="alert">
          <div>
            <strong>主机服务不可用</strong>
            <p>主机可能已切换到公用网络或关闭了应用。当前文件列表是离线缓存，可能已过期。</p>
          </div>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              setOnline(null);
              void loadInfo();
              void refresh();
            }}
          >
            重新连接
          </button>
        </div>
      )}
      <div className="dashboard-grid">
        <article className="card files-card">
          <div className="card-head">
            <div>
              <h2>文件列表</h2>
            </div>
            <div className="card-actions">
              <span className="count-badge">{files.length}</span>
              {files.length > 0 && (
                <button type="button" className="btn btn-ghost btn-small" onClick={toggleSelectAll} disabled={online === false}>
                  {allSelected ? '取消全选' : '全选'}
                </button>
              )}
              {selectedIds.size > 0 && (
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  onClick={() => void saveSelected()}
                  disabled={online === false || batchSaving || batchDeleting || savingId !== null}
                >
                  {desktop ? '保存所选' : '下载所选'} ({selectedIds.size})
                </button>
              )}
              {selectedIds.size > 0 && (
                <button
                  type="button"
                  className="btn btn-danger btn-small"
                  onClick={() => void deleteSelected()}
                  disabled={online === false || batchDeleting || batchSaving || savingId !== null}
                >
                  {batchDeleting ? '删除中…' : `删除所选 (${selectedIds.size})`}
                </button>
              )}
              {desktop && (
                <button type="button" className="btn btn-ghost btn-small" onClick={openDownloadDir} title="打开下载文件夹">
                  <Icon name="folder" size={14} /> 打开
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-small" onClick={() => void refresh()}>
                刷新
              </button>
            </div>
          </div>

          {online === false && (
            <p className="offline-cache-note" role="status">
              <Icon name="alert" size={14} /> 离线缓存，可能已过期
            </p>
          )}

          <div
            className={`drop-zone${dragging ? ' dragging' : ''}${online === false ? ' is-disabled' : ''}`}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (online === false) return;
              if (e.dataTransfer.files.length > 0) void handleFiles(e.dataTransfer.files);
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              if (online === false) return;
              setDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (online === false) return;
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onClick={() => {
              if (online === false) return;
              inputRef.current?.click();
            }}
            onKeyDown={(e) => {
              if (online === false) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            role="button"
            tabIndex={online === false ? -1 : 0}
            aria-disabled={online === false}
            aria-label="选择文件上传到电脑"
          >
            <span className="drop-icon" aria-hidden><Icon name="plus" size={20} /></span>
            <p><strong>选择文件</strong>，或拖放到这里</p>
            <p className="hint">支持多选 / 拖放</p>
          </div>

          {needsPicker && (
            <div className="ios-media-picker">
              <button type="button" className="btn btn-small btn-ghost" onClick={() => mediaInputRef.current?.click()} disabled={online === false}>
                选择照片 / 视频
              </button>
              <span>Safari 可连续选择多张；iCloud 照片请先下载原片</span>
            </div>
          )}

          <input
            ref={inputRef}
            type="file"
            multiple
            disabled={online === false}
            aria-label="选择要上传的文件"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                selectFiles(e.target.files);
              }
              e.target.value = '';
            }}
          />

          <input
            ref={mediaInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            disabled={online === false}
            aria-label="选择照片或视频"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                selectFiles(e.target.files);
              }
              e.target.value = '';
            }}
          />

          {pendingFiles.length > 0 && (
            <div className="pending-files" role="status">
              <p>已选择 {pendingFiles.length} 个文件，可继续添加后统一上传。</p>
              <div className="pending-actions">
                <button type="button" className="btn btn-small btn-ghost" onClick={() => mediaInputRef.current?.click()} disabled={online === false}>
                  继续选择
                </button>
                <button type="button" className="btn btn-small btn-primary" onClick={uploadPending} disabled={online === false}>
                  开始上传
                </button>
                <button type="button" className="btn btn-small btn-ghost" onClick={() => setPendingFiles([])}>
                  清空
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-error form-error">{error}</p>}

          <div className="file-list">
            {files.map((file) => (
                <div key={file.id} className={`file-item file-row${selectedIds.has(file.id) ? ' selected' : ''}`}>
                  <input
                    type="checkbox"
                    className="file-select"
                    checked={selectedIds.has(file.id)}
                    onChange={() => toggleSelected(file.id)}
                    disabled={online === false}
                    aria-label={`选择 ${file.name}`}
                  />
                  <span className="file-icon file-ext" aria-hidden>{fileExtension(file.name)}</span>
                  <div className="file-main" title={file.name}>
                    <div className="file-name">{file.name}</div>
                    <div className="file-status">
                      {formatBytes(file.size)} · SHA-256 {file.sha256.slice(0, 10)}…
                    </div>
                  </div>
                  <div className="file-actions">
                    {desktop ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-small btn-ghost"
                          onClick={() => void saveDownload(file)}
                          disabled={online === false || savingId !== null || batchSaving || batchDeleting}
                          title={`保存 ${file.name}`}
                        >
                          {savingId === file.id ? '保存中…' : savedPaths[file.id] ? '重新保存' : (<><Icon name="download" size={14} /> 保存</>)}
                        </button>
                        {savedPaths[file.id] && (
                          <button
                            type="button"
                            className="btn btn-icon"
                            onClick={() => openPath(savedPaths[file.id])}
                            title="打开所在文件夹"
                            aria-label="打开所在文件夹"
                          >
                            <Icon name="folder" size={14} />
                          </button>
                        )}
                      </>
                    ) : (
                      <a
                        className={`btn btn-small btn-ghost${online === false ? ' is-disabled' : ''}`}
                        href={`${API_BASE}/api/files/${file.id}?token=${encodeURIComponent(token)}`}
                        download={file.name}
                        aria-disabled={online === false}
                        onClick={(event) => {
                          if (online === false) {
                            event.preventDefault();
                            return;
                          }
                          setToast({ text: '已开始下载，请查看浏览器下载列表', kind: 'info' });
                        }}
                        title={`下载 ${file.name}`}
                        aria-label={`下载 ${file.name}`}
                      >
                        <Icon name="download" size={14} />
                      </a>
                    )}
                    <button
                      type="button"
                      className="btn btn-icon"
                      onClick={() => void deleteFile(file.id)}
                      disabled={online === false}
                      title={`删除 ${file.name}`}
                      aria-label={`删除 ${file.name}`}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </article>

        <article className={`card progress-card${hasActiveTransfer ? '' : ' is-idle'}`}>
          <div className="card-head">
            <div>
              <h2>传输进度</h2>
              {hasActiveTransfer && <p>上传、接收和保存的实时状态。</p>}
            </div>
            {!hasActiveTransfer && <span className="status-pill warn">空闲</span>}
          </div>

          <div className="rate-grid">
            <RateCard
              label="上传"
              icon="↑"
              speed={effectiveUploadSpeed}
              peak={uploadPeak}
              total={uploadTotal}
              history={uploadHistory}
              tone="blue"
            />
            <RateCard
              label="下载"
              icon="↓"
              speed={effectiveDownloadSpeed}
              peak={downloadPeak}
              total={downloadTotal}
              history={downloadHistory}
              tone="green"
            />
          </div>

          {upload && (
            <div className="progress-block">
              <div className="progress-row">
                <span className="progress-title">
                  {uploadIsBatch
                    ? `总进度 · 第 ${upload.batchIndex || 1}/${upload.batchCount} 个 · ${upload.name}`
                    : `上传 ${upload.name}`}
                </span>
                <strong>{uploadPercent}%</strong>
              </div>
              <div className="progress-bar" role="progressbar" aria-label={uploadIsBatch ? '上传总进度' : undefined} aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadPercent}>
                <div className="progress-fill" style={{ width: `${uploadPercent}%` }} />
              </div>
              <div className="progress-meta">
                <span>{formatBytes(uploadLoadedBytes)} / {formatBytes(uploadTotalBytes)}</span>
                {upload.status === 'uploading' && <span>{formatBytes(uploadSpeed)}/s</span>}
                {(upload.status === 'uploading' || upload.status === 'retrying') && <span>剩余 {formatDuration(uploadEta)}</span>}
                {upload.status === 'done' && (
                  <span className="upload-done">
                    <Icon name="check" size={13} /> {uploadPercent >= 100 ? '已上传' : '当前文件已上传'}
                  </span>
                )}
                {upload.status === 'retrying' && !upload.checking && <span>连接中断，正在重试…</span>}
                {upload.checking && <span>正在核对服务器已保存进度…</span>}
                {upload.status === 'cancelled' && <span>已取消，可继续上传</span>}
                {upload.status === 'error' && <span className="text-error" role="alert">{upload.error || '上传失败'}</span>}

              </div>
              <details className="upload-diag" open={upload.status === 'error'}>
                <summary>上传诊断</summary>
                <dl>
                  <dt>模式</dt><dd><select value={transport} onChange={(event) => setTransport(event.target.value as UploadTransport)} aria-label="上传传输方式"><option value="xhr-blob">XHR Blob</option><option value="fetch-blob">Fetch Blob</option></select> · {uploadDiagnostic?.mode}</dd>
                  <dt>分块</dt><dd>{formatBytes(uploadDiagnostic?.chunkBytes || 0)}</dd>
                  <dt>浏览器已发送</dt><dd>{formatBytes(uploadDiagnostic?.browserSent || 0)}</dd>
                  <dt>服务器请求已读取</dt><dd>{uploadDiagnostic?.serverBodyRead == null ? '—' : formatBytes(uploadDiagnostic.serverBodyRead)}</dd>
                  <dt>服务端落盘</dt><dd>{uploadDiagnostic?.serverPartSize == null ? '—' : formatBytes(uploadDiagnostic.serverPartSize)}</dd>
                  <dt>客户端确认 offset</dt><dd>{formatBytes(uploadDiagnostic?.serverConfirmed || 0)}</dd>
                  <dt>请求状态</dt><dd>{uploadDiagnostic?.serverBodyState ?? '—'} · {uploadDiagnostic?.requestPhase ?? '—'}</dd>
                  <dt>服务端状态码</dt><dd>{uploadDiagnostic?.serverStatusCode ?? '—'}</dd>
                  <dt>Content-Length</dt><dd>{uploadDiagnostic?.contentLength ?? '—'}</dd>
                  <dt>Transfer-Encoding</dt><dd>{uploadDiagnostic?.transferEncoding ?? '—'}</dd>
                  <dt>Expect</dt><dd>{uploadDiagnostic?.expect ?? '—'}</dd>
                  <dt>耗时</dt><dd>{uploadDiagnostic?.durationMs == null ? '—' : `${uploadDiagnostic.durationMs}ms`}</dd>
                  {uploadDiagnostic?.serverLastError && <><dt>请求错误</dt><dd>{uploadDiagnostic.serverLastError}</dd></>}
                </dl>
                <CopyButton text={JSON.stringify(uploadDiagnostic, null, 2)} label="复制上传诊断" />
              </details>
              {(upload.status === 'uploading' || upload.status === 'retrying') && (
                <button type="button" className="btn btn-small btn-ghost" onClick={cancelUpload}>
                  取消
                </button>
              )}
              {upload.status === 'error' && upload.file && (
                <button type="button" className="btn btn-small btn-primary" onClick={resumeUpload}>
                  继续上传
                </button>
              )}
              {upload.status === 'cancelled' && upload.file && (
                <button type="button" className="btn btn-small" onClick={resumeUpload}>
                  重新上传
                </button>
              )}
              {upload.status === 'done' && desktop && (
                <button type="button" className="btn btn-small btn-ghost" onClick={() => void openDownloadDir()}>
                  打开下载文件夹
                </button>
              )}
            </div>
          )}

          {showLiveUpload && visibleLiveUpload && (
            <div className="progress-block">
              <div className="progress-row">
                <span className="progress-title">接收 {visibleLiveUpload.name}</span>
                <strong>{livePercent}%</strong>
              </div>
              <div className="progress-bar" role="progressbar" aria-label="接收进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={livePercent}>
                <div className="progress-fill" style={{ width: `${livePercent}%` }} />
              </div>
              <div className="progress-meta">
                <span>{formatBytes(visibleLiveUpload.loaded)} / {formatBytes(visibleLiveUpload.total)}</span>
                {liveSpeed > 0 && <span>{formatBytes(liveSpeed)}/s</span>}
                {liveEta > 0 && <span>剩余 {formatDuration(liveEta)}</span>}
              </div>
            </div>
          )}

          {activeDownload && (
            <div className="progress-block">
              <div className="progress-row">
                <span className="progress-title">保存 {activeDownload.name}</span>
                <strong>{downloadPercent}%</strong>
              </div>
              <div className="progress-bar" role="progressbar" aria-label="保存进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={downloadPercent}>
                <div className="progress-fill" style={{ width: `${downloadPercent}%` }} />
              </div>
              <div className="progress-meta">
                <span>{formatBytes(activeDownload.loaded)} / {formatBytes(activeDownload.total)}</span>
                {downloadSpeed > 0 && <span>{formatBytes(downloadSpeed)}/s</span>}
                {downloadEta > 0 && <span>剩余 {formatDuration(downloadEta)}</span>}
                <button
                  type="button"
                  className="btn btn-small btn-ghost"
                  onClick={cancelDownload}
                  disabled={activeDownload.status === 'cancelling'}
                >
                  {activeDownload.status === 'cancelling' ? '取消中…' : '取消'}
                </button>
              </div>
            </div>
          )}
        </article>

        <article className="card connection-card">
          <div className="card-head">
            <div>
              <h2>{desktop ? '扫码连接' : '连接状态'}</h2>
              {desktop && <p>同一 WiFi 下，手机扫码即可打开。</p>}
            </div>
            <span className={`status-pill ${statusClass === 'chip-ok' ? 'ok' : statusClass === 'chip-bad' ? 'danger' : 'warn'}`}>
              {statusLabel}
            </span>
          </div>

          {serviceNotice}

          {!desktop && token && (
            <p className="connected-phone-line">已连接 {window.location.host}</p>
          )}

          {desktop && online === true && (
            phoneUrl ? (
              <JoinQr
                url={phoneUrl}
                displayUrl={showCode ? phoneUrl : phoneUrl.replace(/([?&#]code=)\d{6}/, '$1••••••')}
                title="手机扫码打开"
                subtitle="配对码已自动带入，无需手动输入"
                actions={(
                  <button
                    type="button"
                    className="btn btn-small btn-ghost"
                    aria-pressed={showCode}
                    onClick={() => setShowCode((value) => !value)}
                  >
                    {showCode ? '隐藏 code' : '显示 code'}
                  </button>
                )}
              />
            ) : (
              <p className="hint">
                {sessionCode
                  ? '未检测到局域网 IP，请确认电脑已连接 WiFi/网线后刷新。'
                  : '已通过主机确认连接。'}
              </p>
            )
          )}

          {desktop && pairingDetails}
        </article>

        <ClipboardPanel
          token={token}
          desktop={desktop}
          online={online}
          publicPaused={publicPaused}
        />

        <NearbyComputers
          onConnect={setPeerFrame}
          activePeerId={peerFrame?.id}
          activeState={peerState}
        />


      </div>


      {peerFrame && (
        <div className="peer-frame-overlay">
          <header className="peer-frame-head">
            <div>
              <strong>正在连接 {peerFrame.name}</strong>
              <span>{peerFrame.ip}:{peerFrame.port}</span>
            </div>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setPeerFrame(null)}>
              关闭
            </button>
          </header>
          <iframe
            ref={peerFrameRef}
            className="peer-frame"
            src={`${peerFrame.url}?connect=1`}
            title={`连接 ${peerFrame.name}`}
          />
        </div>
      )}

      {toast && (
        <div className={`toast toast-${toast.kind}`} role="status">
          <span className="toast-text">{toast.text}</span>
          {toast.path && (
            <button type="button" className="toast-action" onClick={() => openPath(toast.path!)}>
              打开
            </button>
          )}
          <button type="button" className="toast-close" onClick={() => setToast(null)} aria-label="关闭提示">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {online === true && isViteDev && (
        <p className="hint vite-hint">当前页面来自 Vite；生产环境可直接用上面的 Hub 地址访问。</p>
      )}
    </div>
  );
}
