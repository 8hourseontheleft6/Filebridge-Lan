import { useEffect, useRef, useState } from 'react';
import { CopyButton } from '../components/CopyButton';
import { JoinQr } from '../components/JoinQr';
import { formatBytes, formatDuration } from '../lib/format';
import {
  buildRelayLink,
  completeRelayTransfer,
  createRelayTransfer,
  defaultRelayBase,
  downloadRelayChunk,
  getRelayByCode,
  normalizeRelayBase,
  saveRelayBase,
  uploadRelayChunk,
  type RelayLink,
  type RelayMeta,
} from './api';
import { decryptChunk, encryptChunk, importTransferKey, randomTransferKey } from './crypto';

const CHUNK_SIZE = 4 * 1024 * 1024;

interface RelayTransferProps {
  initialLink?: RelayLink | null;
  standalone?: boolean;
}

interface SendProgress {
  loaded: number;
  total: number;
  startedAt: number;
}

interface ResultState {
  code: string;
  link: string;
  expiresAt: number;
}

function percentOf(loaded: number, total: number): number {
  if (total <= 0) return loaded > 0 ? 100 : 0;
  return Math.min(100, Math.round((loaded / total) * 100));
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return '已取消';
    return error.message;
  }
  return String(error);
}

export function RelayTransfer({ initialLink, standalone = false }: RelayTransferProps) {
  const [tab, setTab] = useState<'send' | 'receive'>(initialLink ? 'receive' : 'send');
  const [relayBase, setRelayBase] = useState(() => (initialLink ? window.location.origin : defaultRelayBase()));
  const [baseSaved, setBaseSaved] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState<SendProgress | null>(null);
  const [sendError, setSendError] = useState('');
  const [result, setResult] = useState<ResultState | null>(null);

  const [receiveCode, setReceiveCode] = useState(initialLink?.code || '');
  const [receiveKey, setReceiveKey] = useState(initialLink?.key || '');
  const [meta, setMeta] = useState<RelayMeta | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [receiveProgress, setReceiveProgress] = useState<SendProgress | null>(null);
  const [receiveError, setReceiveError] = useState('');
  const [saved, setSaved] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendAbortRef = useRef<AbortController | null>(null);
  const receiveAbortRef = useRef<AbortController | null>(null);

  const sendPercent = sendProgress ? percentOf(sendProgress.loaded, sendProgress.total) : 0;
  const sendElapsed = sendProgress ? Math.max(0.001, (Date.now() - sendProgress.startedAt) / 1000) : 0;
  const sendSpeed = sendProgress && sendElapsed > 0 ? sendProgress.loaded / sendElapsed : 0;
  const sendEta = sendProgress && sendSpeed > 0
    ? Math.max(0, (sendProgress.total - sendProgress.loaded) / sendSpeed)
    : 0;

  const receivePercent = receiveProgress
    ? percentOf(receiveProgress.loaded, receiveProgress.total)
    : 0;
  const receiveElapsed = receiveProgress
    ? Math.max(0.001, (Date.now() - receiveProgress.startedAt) / 1000)
    : 0;
  const receiveSpeed = receiveProgress && receiveElapsed > 0
    ? receiveProgress.loaded / receiveElapsed
    : 0;
  const receiveEta = receiveProgress && receiveSpeed > 0
    ? Math.max(0, (receiveProgress.total - receiveProgress.loaded) / receiveSpeed)
    : 0;

  async function loadMeta(code = receiveCode) {
    setLoadingMeta(true);
    setReceiveError('');
    setMeta(null);
    setSaved(false);
    try {
      const base = normalizeRelayBase(relayBase);
      const data = await getRelayByCode(base, code);
      if (!data.completed) throw new Error('发送方尚未完成上传，请稍后再试');
      setMeta(data);
    } catch (error) {
      setReceiveError(errorText(error));
    } finally {
      setLoadingMeta(false);
    }
  }

  useEffect(() => {
    if (initialLink?.code) {
      void loadMeta(initialLink.code);
    }
    // initialLink 只用于首次打开
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveBase() {
    try {
      setRelayBase(saveRelayBase(relayBase));
      setBaseSaved(true);
      window.setTimeout(() => setBaseSaved(false), 2000);
    } catch (error) {
      setSendError(errorText(error));
    }
  }

  async function sendFile() {
    if (!file || sending) return;
    const controller = new AbortController();
    sendAbortRef.current = controller;
    setSending(true);
    setSendError('');
    setResult(null);
    setSendProgress({ loaded: 0, total: file.size, startedAt: Date.now() });

    try {
      const base = normalizeRelayBase(relayBase);
      const keyText = randomTransferKey();
      const key = await importTransferKey(keyText);
      const created = await createRelayTransfer(base, {
        name: file.name,
        size: file.size,
        chunkSize: CHUNK_SIZE,
      }, controller.signal);

      const startedAt = Date.now();
      setSendProgress({ loaded: 0, total: file.size, startedAt });

      for (let index = 0; index < created.chunks; index += 1) {
        if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError');
        const start = index * created.chunkSize;
        const end = Math.min(file.size, start + created.chunkSize);
        const plain = await file.slice(start, end).arrayBuffer();
        const encrypted = await encryptChunk(key, index, plain);
        await uploadRelayChunk(base, created.id, index, encrypted, created.uploadToken, controller.signal);
        setSendProgress({ loaded: end, total: file.size, startedAt });
      }

      await completeRelayTransfer(base, created.id, created.uploadToken, controller.signal);
      const link = buildRelayLink(base, created.code, keyText);
      setResult({ code: created.code, link, expiresAt: created.expiresAt });
    } catch (error) {
      setSendError(errorText(error));
    } finally {
      setSending(false);
      sendAbortRef.current = null;
    }
  }

  function cancelSend() {
    sendAbortRef.current?.abort();
  }

  async function receiveFile() {
    if (!meta || receiving) return;
    if (!receiveKey.trim()) {
      setReceiveError('缺少解密密钥；请使用完整接收链接，或手动粘贴 # 后的 key');
      return;
    }

    const controller = new AbortController();
    receiveAbortRef.current = controller;
    setReceiving(true);
    setReceiveError('');
    setSaved(false);
    const startedAt = Date.now();
    setReceiveProgress({ loaded: 0, total: meta.size, startedAt });

    try {
      const base = normalizeRelayBase(relayBase);
      const key = await importTransferKey(receiveKey.trim());
      const parts: BlobPart[] = [];
      let loaded = 0;

      for (let index = 0; index < meta.chunks; index += 1) {
        if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError');
        const encrypted = await downloadRelayChunk(base, meta.id, index, meta.code, controller.signal);
        const plain = await decryptChunk(key, index, encrypted);
        parts.push(plain);
        loaded += plain.byteLength;
        setReceiveProgress({ loaded, total: meta.size, startedAt });
      }

      const blob = new Blob(parts, { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = meta.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setSaved(true);
    } catch (error) {
      setReceiveError(errorText(error));
    } finally {
      setReceiving(false);
      receiveAbortRef.current = null;
    }
  }

  function cancelReceive() {
    receiveAbortRef.current?.abort();
  }

  function resetSend() {
    setFile(null);
    setResult(null);
    setSendProgress(null);
    setSendError('');
  }

  const showTabs = !initialLink;

  return (
    <section className={`panel relay-panel${standalone ? ' relay-panel-standalone' : ''}`}>
      <div className="panel-head">
        <h2>{initialLink ? '📥 跨网络接收' : '🌍 跨网络传输（实验）'}</h2>
        <span className="chip chip-warn">E2E Relay</span>
      </div>

      <p className="hint relay-intro">
        文件在本机用 AES-GCM 加密后上传；中继只保存密文。解密密钥放在链接的 <code>#</code> 后面，不会发送到服务器。
      </p>

      {!initialLink && (
        <>
          <label className="field-label" htmlFor="relay-base">中继地址</label>
          <div className="path-row">
            <input
              id="relay-base"
              className="input"
              value={relayBase}
              onChange={(event) => setRelayBase(event.target.value)}
              placeholder="https://relay.example.com"
              spellCheck={false}
            />
            <button type="button" className="btn btn-small" onClick={saveBase}>
              {baseSaved ? '已保存' : '保存'}
            </button>
          </div>
          <p className="hint">
            本地开发可用 <code>http://127.0.0.1:43000</code>；公网接收请部署 HTTPS 中继（见 docs/CROSS-NETWORK.md）。
          </p>
        </>
      )}

      {showTabs && (
        <div className="relay-tabs" role="tablist" aria-label="跨网络传输方式">
          <button
            type="button"
            className={`btn btn-small${tab === 'send' ? ' btn-primary' : ''}`}
            onClick={() => setTab('send')}
            role="tab"
            aria-selected={tab === 'send'}
          >
            📤 发送
          </button>
          <button
            type="button"
            className={`btn btn-small${tab === 'receive' ? ' btn-primary' : ''}`}
            onClick={() => setTab('receive')}
            role="tab"
            aria-selected={tab === 'receive'}
          >
            📥 接收
          </button>
        </div>
      )}

      {(tab === 'send' || initialLink) && !initialLink && (
        <div className="relay-body">
          <input
            ref={fileInputRef}
            type="file"
            className="relay-file-input"
            onChange={(event) => {
              setFile(event.target.files?.[0] || null);
              setResult(null);
              setSendError('');
            }}
          />
          <div className="connect-form">
            <button type="button" className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
              选择文件
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void sendFile()}
              disabled={!file || sending}
            >
              {sending ? '加密上传中…' : '加密并上传'}
            </button>
          </div>
          {file && (
            <p className="hint">
              {file.name} · {formatBytes(file.size)}
            </p>
          )}

          {sending && sendProgress && (
            <div className="upload-card">
              <div className="upload-head">
                <span className="file-name">🔐 加密上传 {file?.name}</span>
                <strong className="upload-percent">{sendPercent}%</strong>
              </div>
              <div className="progress-bar" role="progressbar" aria-valuenow={sendPercent} aria-valuemin={0} aria-valuemax={100}>
                <div className="progress-fill" style={{ width: `${sendPercent}%` }} />
              </div>
              <div className="progress-meta">
                <span>{formatBytes(sendProgress.loaded)} / {formatBytes(sendProgress.total)}</span>
                {sendSpeed > 0 && <span>{formatBytes(sendSpeed)}/s</span>}
                {sendEta > 0 && <span>剩余 {formatDuration(sendEta)}</span>}
                <button type="button" className="btn btn-small" onClick={cancelSend}>取消</button>
              </div>
            </div>
          )}

          {sendError && <p className="text-error relay-error">{sendError}</p>}

          {result && (
            <div className="relay-result">
              <JoinQr
                url={result.link}
                title="手机扫码接收（跨网络）"
                subtitle="链接 # 后是解密密钥；中继服务器看不到明文"
              />
              <div className="relay-code-line">
                <span>传输码</span>
                <strong className="relay-code">{result.code}</strong>
                <CopyButton text={result.code} label="复制传输码" />
              </div>
              <p className="hint">
                有效期至 {new Date(result.expiresAt).toLocaleString()}；接收方必须使用完整链接或同时输入传输码 + 密钥。
              </p>
              <div className="relay-actions">
                <CopyButton text={result.link} label="复制接收链接" />
                <button type="button" className="btn btn-small" onClick={resetSend}>再传一个</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'receive' && (
        <div className="relay-body">
          {!initialLink && (
            <p className="hint">收到完整链接时，传输码和密钥会自动填入；也可以手动粘贴。</p>
          )}
          <label className="field-label" htmlFor="relay-code">传输码</label>
          <input
            id="relay-code"
            className="input"
            value={receiveCode}
            onChange={(event) => setReceiveCode(event.target.value.toUpperCase())}
            maxLength={8}
            placeholder="8 位传输码"
            spellCheck={false}
            autoComplete="off"
          />
          <label className="field-label" htmlFor="relay-key">解密密钥（链接 # 后）</label>
          <input
            id="relay-key"
            className="input relay-key"
            value={receiveKey}
            onChange={(event) => setReceiveKey(event.target.value.trim())}
            placeholder="例如 7Kx...（base64url）"
            spellCheck={false}
            autoComplete="off"
          />
          <div className="connect-form">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void loadMeta()}
              disabled={loadingMeta || !receiveCode.trim()}
            >
              {loadingMeta ? '查询中…' : '查询文件'}
            </button>
          </div>

          {receiveError && <p className="text-error relay-error">{receiveError}</p>}

          {meta && (
            <div className="relay-meta">
              <p><strong>{meta.name}</strong> · {formatBytes(meta.size)}</p>
              <p className="hint">分片 {meta.chunks} 个 · 有效至 {new Date(meta.expiresAt).toLocaleString()}</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void receiveFile()}
                disabled={receiving}
              >
                {receiving ? '下载解密中…' : '下载并解密'}
              </button>
            </div>
          )}

          {receiving && receiveProgress && (
            <div className="upload-card">
              <div className="upload-head">
                <span className="file-name">🔓 下载解密 {meta?.name}</span>
                <strong className="upload-percent">{receivePercent}%</strong>
              </div>
              <div className="progress-bar" role="progressbar" aria-valuenow={receivePercent} aria-valuemin={0} aria-valuemax={100}>
                <div className="progress-fill" style={{ width: `${receivePercent}%` }} />
              </div>
              <div className="progress-meta">
                <span>{formatBytes(receiveProgress.loaded)} / {formatBytes(receiveProgress.total)}</span>
                {receiveSpeed > 0 && <span>{formatBytes(receiveSpeed)}/s</span>}
                {receiveEta > 0 && <span>剩余 {formatDuration(receiveEta)}</span>}
                <button type="button" className="btn btn-small" onClick={cancelReceive}>取消</button>
              </div>
            </div>
          )}

          {saved && <p className="hint relay-saved">已触发浏览器下载，请查看下载列表。</p>}
        </div>
      )}
    </section>
  );
}
