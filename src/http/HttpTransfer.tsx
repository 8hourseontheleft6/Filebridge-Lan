import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { formatBytes, formatDuration } from '../lib/format';
import { API_BASE, isTauriHost, resolvePhoneBase, type HubInfo } from '../lib/hub';
import { JoinQr } from '../components/JoinQr';
import { CopyButton } from '../components/CopyButton';

const SESSION_STORAGE_KEY = 'filebridge_session_code';
const TOKEN_STORAGE_KEY = 'filebridge_session_token';

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

interface UploadState {
  name: string;
  loaded: number;
  total: number;
  startedAt: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return '🖼️';
  if (['mp4', 'mov', 'mkv', 'avi', 'webm'].includes(ext)) return '🎬';
  if (['mp3', 'wav', 'flac', 'aac', 'm4a'].includes(ext)) return '🎵';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) return '📦';
  if (['pdf'].includes(ext)) return '📕';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  return '📄';
}

export function HttpTransfer() {
  const desktop = isTauriHost();
  const [online, setOnline] = useState<boolean | null>(null);
  const [info, setInfo] = useState<HubInfo | null>(null);
  const [files, setFiles] = useState<HubFile[]>([]);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedPaths, setSavedPaths] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<ToastState | null>(null);
  const [activeDownload, setActiveDownload] = useState<ActiveDownload | null>(null);
  const [liveUpload, setLiveUpload] = useState<LiveUpload | null>(null);
  const [sessionCode, setSessionCode] = useState(() => readSessionCode());
  const [token, setToken] = useState(() => readToken());
  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState('');
  const [sessionReady, setSessionReady] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [rotating, setRotating] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

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
    try {
      const response = await fetch(`${API_BASE}/api/files`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) {
        setToken('');
        setCodeError('授权已过期，请重新配对');
        try { window.sessionStorage.removeItem(TOKEN_STORAGE_KEY); } catch { /* ignore */ }
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as HubFile[];
      setFiles(Array.isArray(data) ? data : []);
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, [sessionReady, token]);

  useEffect(() => {
    if (!online || !token || !sessionReady) return;
    const source = new EventSource(
      `${API_BASE}/api/events?token=${encodeURIComponent(token)}`
    );
    const onUpload = (event: Event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as UploadEventPayload;
        if (data.status === 'started' || data.status === 'progress') {
          setLiveUpload((prev) => ({
            id: data.id,
            name: data.name,
            loaded: data.loaded,
            total: data.total || (prev?.id === data.id ? prev.total : 0),
            startedAt: prev?.id === data.id ? prev.startedAt : Date.now(),
          }));
        } else if (data.status === 'completed') {
          setLiveUpload(null);
          setToast({ text: `已接收 ${data.name}`, kind: 'success' });
          void refresh();
        } else if (data.status === 'failed') {
          setLiveUpload(null);
          setToast({ text: `接收失败：${data.name}`, kind: 'error' });
        }
      } catch {
        // 忽略格式不完整的事件
      }
    };
    source.addEventListener('upload', onUpload);
    return () => {
      source.removeEventListener('upload', onUpload);
      source.close();
    };
  }, [online, sessionReady, token, refresh]);

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

  const uploadOne = useCallback((file: File): Promise<HubFile> => {
    if (!token) return Promise.reject(new Error('缺少访问授权'));
    return new Promise<HubFile>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/api/upload?name=${encodeURIComponent(file.name)}`);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        setUpload(prev => prev ? { ...prev, loaded: event.loaded, total: event.total } : prev);
      };

      xhr.onload = () => {
        xhrRef.current = null;
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as HubFile);
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
        let message = xhr.status === 413
          ? '文件超过 Hub 限制'
          : '上传失败，请确认电脑端服务在线并重试';
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
        reject(new Error('网络错误，HTTP Hub 可能未启动'));
      };
      xhr.onabort = () => {
        xhrRef.current = null;
        reject(new Error('已取消'));
      };

      xhrRef.current = xhr;
      xhr.send(file);
    });
  }, [token]);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const selected = Array.from(fileList);
    if (selected.length === 0) return;
    if (online === false) {
      setError('HTTP Hub 未启动，请先在电脑上运行 npm run hub');
      return;
    }

    setError('');
    for (const file of selected) {
      setUpload({
        name: file.name,
        loaded: 0,
        total: file.size,
        startedAt: Date.now(),
        status: 'uploading',
      });
      try {
        const saved = await uploadOne(file);
        setUpload(prev => prev ? {
          ...prev,
          loaded: saved.size,
          total: saved.size,
          status: 'done',
        } : null);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setUpload(prev => prev ? { ...prev, status: 'error', error: message } : prev);
        setError(message);
        break;
      }
    }
    await refresh();
  }, [online, refresh, uploadOne]);

  const cancelUpload = useCallback(() => {
    xhrRef.current?.abort();
  }, []);

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
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败，请稍后重试');
    }
  }, [refresh, token]);

  const openPath = useCallback((path: string) => {
    if (!desktop) return;
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

  const saveDownload = useCallback(async (file: HubFile) => {
    if (!desktop || savingId) return;
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
      setToast({
        text: result.existed ? `文件已存在，未重复保存：${result.path}` : `下载完成：${result.path}`,
        kind: 'success',
        path: result.path,
      });
    } catch (reason) {
      const message = String(reason);
      if (message.includes('已取消')) {
        setToast({ text: '已取消保存', kind: 'info' });
      } else {
        setToast({ text: `保存失败：${message}`, kind: 'error' });
      }
    } finally {
      setSavingId(null);
      setActiveDownload(null);
    }
  }, [desktop, savingId]);

  const cancelDownload = useCallback(() => {
    if (!activeDownload || activeDownload.status === 'cancelling') return;
    const { transferId } = activeDownload;
    setActiveDownload((prev) => (prev ? { ...prev, status: 'cancelling' } : prev));
    void invoke('cancel_download', { transferId }).catch((reason) => {
      setToast({ text: `取消失败：${String(reason)}`, kind: 'error' });
    });
  }, [activeDownload]);

  const phoneBase = resolvePhoneBase(info);
  const phoneUrl = phoneBase && sessionCode
    ? `${phoneBase}/#code=${encodeURIComponent(sessionCode)}`
    : '';
  const isViteDev = window.location.port === '5173';
  const uploadPercent = upload
    ? (upload.total > 0 ? Math.min(100, Math.round((upload.loaded / upload.total) * 100)) : 100)
    : 0;
  const uploadElapsed = upload && upload.status === 'uploading'
    ? Math.max(0.001, (Date.now() - upload.startedAt) / 1000)
    : 0;
  const uploadSpeed = uploadElapsed > 0 && upload ? upload.loaded / uploadElapsed : 0;
  const uploadEta = uploadSpeed > 0 && upload ? Math.max(0, (upload.total - upload.loaded) / uploadSpeed) : 0;
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
  const showLiveUpload = liveUpload && !(upload && upload.status === 'uploading');
  const livePercent = liveUpload
    ? (liveUpload.total > 0
      ? Math.min(100, Math.round((liveUpload.loaded / liveUpload.total) * 100))
      : (liveUpload.loaded > 0 ? 100 : 0))
    : 0;
  const liveElapsed = liveUpload
    ? Math.max(0.001, (Date.now() - liveUpload.startedAt) / 1000)
    : 0;
  const liveSpeed = liveUpload && liveElapsed > 0 ? liveUpload.loaded / liveElapsed : 0;
  const liveEta = liveUpload && liveSpeed > 0
    ? Math.max(0, (liveUpload.total - liveUpload.loaded) / liveSpeed)
    : 0;

  const pairingLabel = token ? '已配对' : codeError ? '授权已过期' : '未配对';
  const canRotate = desktop
    || window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  const statusLabel = !sessionReady
    ? '读取中'
    : online === null
      ? '连接中'
      : online === false
        ? '服务不可用'
        : !token
          ? (codeError ? '授权已过期' : '需要配对')
          : '在线';
  const statusClass = statusLabel === '在线'
    ? 'chip-ok'
    : statusLabel === '服务不可用' || statusLabel === '授权已过期'
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
        {codeError && <p className="text-error">{codeError}</p>}
        <p className="hint">
          扫码成功时无需手动操作；配对码只用于换取 12 小时访问授权。
        </p>
      </div>
    </details>
  );

  if (!sessionReady) {
    return (
      <section className="panel lan-panel">
        <div className="panel-head">
          <h2>⚡ 局域网直传</h2>
          <span className="chip chip-warn">读取中</span>
        </div>
        <p className="hint">正在读取本机配对状态…</p>
      </section>
    );
  }

  if (!token) {
    return (
      <section className="panel lan-panel">
        <div className="panel-head">
          <h2>⚡ 局域网直传</h2>
          <span className="chip chip-warn">
            {codeError ? '授权已过期' : '需要配对'}
          </span>
        </div>
        <p className="hint">
          这是一台尚未配对的设备。扫码打开时通常会自动配对；若扫码失败，请在下方手动输入电脑上显示的 6 位配对码。
        </p>
        {online === false && (
          <div className="notice notice-bad">
            <p className="hint">电脑端服务不可用。请确认 Filebridge-Lan 已启动，并允许专用网络防火墙。</p>
            <button type="button" className="btn btn-small" onClick={() => { setOnline(null); void loadInfo(); }}>
              重试连接
            </button>
          </div>
        )}
        {pairingDetails}
      </section>
    );
  }

  return (
    <section className="panel lan-panel">
      <div className="panel-head">
        <h2>⚡ 局域网直传</h2>
        <span className={`chip ${statusClass}`}>{statusLabel}</span>
      </div>

      {online === false && (
        <div className="notice notice-bad">
          <p className="hint">电脑端服务不可用。请确认 Filebridge-Lan 已启动，并允许专用网络防火墙。</p>
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
      )}

      {online === true && (
        phoneUrl ? (
          <JoinQr
            url={phoneUrl}
            displayUrl={showCode ? phoneUrl : phoneUrl.replace(/([?&#]code=)\d{6}/, '$1••••••')}
            title="手机扫码打开"
            subtitle="同一 WiFi；配对码已自动带入，无需手动输入"
            actions={(
              <button
                type="button"
                className="btn btn-small"
                aria-pressed={showCode}
                onClick={() => setShowCode((value) => !value)}
              >
                {showCode ? '隐藏 code' : '显示 code'}
              </button>
            )}
          />
        ) : (
          <p className="hint">
            未检测到局域网 IP，请确认电脑已连接 WiFi/网线后刷新。
          </p>
        )
      )}

      {pairingDetails}

      <div
        className={`drop-zone ${dragging ? 'dragging' : ''}`}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length > 0) void handleFiles(e.dataTransfer.files);
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="选择文件上传到电脑"
      >
        <p>点击选择文件，或拖放到这里</p>
        <p className="hint">支持多选 / 拖放；大文件推荐用这里</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        aria-label="选择要上传的文件"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void handleFiles(e.target.files);
          }
          e.target.value = '';
        }}
      />

      {upload && (
        <div className="upload-card">
          <div className="upload-head">
            <span className="file-name" title={upload.name}>{upload.name}</span>
            <strong className="upload-percent">{uploadPercent}%</strong>
          </div>
          <div
            className="progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={uploadPercent}
          >
            <div className="progress-fill" style={{ width: `${uploadPercent}%` }} />
          </div>
          <div className="progress-meta">
            <span>{formatBytes(upload.loaded)} / {formatBytes(upload.total)}</span>
            {upload.status === 'uploading' && <span>{formatBytes(uploadSpeed)}/s</span>}
            {upload.status === 'uploading' && <span>剩余 {formatDuration(uploadEta)}</span>}
            {upload.status === 'done' && <span>✅ 已上传</span>}
            {upload.status === 'error' && <span className="text-error">❌ {upload.error || '失败'}</span>}
          </div>
          {upload.status === 'uploading' && (
            <button type="button" className="btn btn-small" onClick={cancelUpload}>
              取消
            </button>
          )}
        </div>
      )}

      {error && <p className="text-error" style={{ marginTop: 8, fontSize: '0.85rem', overflowWrap: 'anywhere' }}>{error}</p>}

      {showLiveUpload && liveUpload && (
        <div className="download-live live-upload">
          <div className="download-live-head">
            <span className="download-live-title">📥 正在接收 {liveUpload.name}</span>
            <strong className="upload-percent">{livePercent}%</strong>
          </div>
          <div
            className="progress-bar"
            role="progressbar"
            aria-label="接收进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={livePercent}
          >
            <div className="progress-fill" style={{ width: `${livePercent}%` }} />
          </div>
          <div className="progress-meta">
            <span>{formatBytes(liveUpload.loaded)} / {formatBytes(liveUpload.total)}</span>
            {liveSpeed > 0 && <span>{formatBytes(liveSpeed)}/s</span>}
            {liveEta > 0 && <span>剩余 {formatDuration(liveEta)}</span>}
          </div>
        </div>
      )}

      {activeDownload && (
        <div className="download-live">
          <div className="download-live-head">
            <span className="download-live-title">💾 正在保存 {activeDownload.name}</span>
            <strong className="upload-percent">{downloadPercent}%</strong>
          </div>
          <div
            className="progress-bar"
            role="progressbar"
            aria-label="保存进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={downloadPercent}
          >
            <div className="progress-fill" style={{ width: `${downloadPercent}%` }} />
          </div>
          <div className="progress-meta">
            <span>{formatBytes(activeDownload.loaded)} / {formatBytes(activeDownload.total)}</span>
            {downloadSpeed > 0 && <span>{formatBytes(downloadSpeed)}/s</span>}
            {downloadEta > 0 && <span>剩余 {formatDuration(downloadEta)}</span>}
            <button
              type="button"
              className="btn btn-small"
              onClick={cancelDownload}
              disabled={activeDownload.status === 'cancelling'}
            >
              {activeDownload.status === 'cancelling' ? '取消中…' : '取消'}
            </button>
          </div>
        </div>
      )}

      <div className="list-head">
        <h3>文件 <span className="muted">({files.length})</span></h3>
        <div className="list-head-actions">
          {desktop && (
            <button type="button" className="btn btn-small" onClick={openDownloadDir} title="打开下载文件夹">
              📂 打开
            </button>
          )}
          <button type="button" className="btn btn-small" onClick={() => void refresh()}>
            刷新
          </button>
        </div>
      </div>

      <div className="file-list">
        {files.length === 0 ? (
          <div className="empty-state">
            <span aria-hidden>📭</span>
            <p>还没有文件</p>
            <p className="hint">手机扫码或在这台电脑上传，文件会出现在这里</p>
          </div>
        ) : (
          files.map((file) => (
            <div key={file.id} className="file-item file-row">
              <span className="file-icon" aria-hidden>{fileIcon(file.name)}</span>
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
                      className="btn btn-small"
                      onClick={() => void saveDownload(file)}
                      disabled={savingId !== null}
                      title={`保存 ${file.name}`}
                    >
                      {savingId === file.id ? '保存中…' : savedPaths[file.id] ? '重新保存' : '⬇ 保存'}
                    </button>
                    {savedPaths[file.id] && (
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => openPath(savedPaths[file.id])}
                        title="打开所在文件夹"
                      >
                        📂
                      </button>
                    )}
                  </>
                ) : (
                  <a
                    className="btn btn-small"
                    href={`${API_BASE}/api/files/${file.id}?token=${encodeURIComponent(token)}`}
                    download={file.name}
                    onClick={() => setToast({ text: '已开始下载，请查看浏览器下载列表', kind: 'info' })}
                    title={`下载 ${file.name}`}
                  >
                    ⬇
                  </a>
                )}
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => void deleteFile(file.id)}
                  title={`删除 ${file.name}`}
                >
                  🗑
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {toast && (
        <div className={`toast toast-${toast.kind}`} role="status">
          <span className="toast-text">{toast.text}</span>
          {toast.path && (
            <button type="button" className="toast-action" onClick={() => openPath(toast.path!)}>
              打开
            </button>
          )}
          <button type="button" className="toast-close" onClick={() => setToast(null)} aria-label="关闭提示">
            ✕
          </button>
        </div>
      )}

      {online === true && isViteDev && (
        <p className="hint" style={{ marginTop: 8 }}>
          当前页面来自 Vite；生产环境可直接用上面的 Hub 地址访问。
        </p>
      )}
    </section>
  );
}
