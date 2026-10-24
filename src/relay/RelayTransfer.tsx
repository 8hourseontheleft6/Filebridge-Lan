import { useEffect, useRef, useState } from 'react';
import { sha256 } from '@noble/hashes/sha256';
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
const RELAY_ACCESS_KEY = 'filebridge_relay_access_token';

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
  name: string;
  size: number;
  chunks: number;
  hash: string;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
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
  const [relayAccessToken, setRelayAccessToken] = useState(() => {
    try { return window.localStorage.getItem(RELAY_ACCESS_KEY) || ''; } catch { return ''; }
  });
  const [baseSaved, setBaseSaved] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState<SendProgress | null>(null);
  const [sendError, setSendError] = useState('');
  const [result, setResult] = useState<ResultState | null>(null);

  const [receiveCode, setReceiveCode] = useState(initialLink?.code || '');
  const [receiveKey, setReceiveKey] = useState(initialLink?.key || '');
  const [receiveToken, setReceiveToken] = useState(initialLink?.token || '');
  const [receiveHash, setReceiveHash] = useState(initialLink?.hash || '');
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
      if (!receiveToken.trim()) throw new Error('缺少接收令牌；请使用完整接收链接');
      const base = normalizeRelayBase(relayBase);
      const data = await getRelayByCode(base, code, receiveToken.trim());
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
    if (!relayReady) {
      setSendError(configIssue || '请先完成 Relay 配置');
      return;
    }
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
      }, relayAccessToken.trim(), controller.signal);

      const startedAt = Date.now();
      const digest = sha256.create();
      setSendProgress({ loaded: 0, total: file.size, startedAt });

      for (let index = 0; index < created.chunks; index += 1) {
        if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError');
        const start = index * created.chunkSize;
        const end = Math.min(file.size, start + created.chunkSize);
        const plain = await file.slice(start, end).arrayBuffer();
        digest.update(new Uint8Array(plain));
        const encrypted = await encryptChunk(key, index, plain);
        await uploadRelayChunk(base, created.id, index, encrypted, created.uploadToken, controller.signal);
        setSendProgress({ loaded: end, total: file.size, startedAt });
      }

      await completeRelayTransfer(base, created.id, created.uploadToken, controller.signal);
      const fileHash = toHex(digest.digest());
      const link = buildRelayLink(base, created.code, keyText, created.downloadToken, fileHash);
      setResult({
        code: created.code,
        link,
        expiresAt: created.expiresAt,
        name: file.name,
        size: file.size,
        chunks: created.chunks,
        hash: fileHash,
      });
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
    if (!receiveToken.trim()) {
      setReceiveError('缺少接收令牌；请使用完整接收链接');
      return;
    }
    if (!receiveHash.trim()) {
      setReceiveError('缺少文件 SHA-256；请使用完整接收链接');
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
      const digest = sha256.create();
      const parts: BlobPart[] = [];
      let loaded = 0;

      for (let index = 0; index < meta.chunks; index += 1) {
        if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError');
        const encrypted = await downloadRelayChunk(base, meta.id, index, meta.code, receiveToken.trim(), controller.signal);
        const plain = await decryptChunk(key, index, encrypted);
        digest.update(new Uint8Array(plain));
        parts.push(plain);
        loaded += plain.byteLength;
        setReceiveProgress({ loaded, total: meta.size, startedAt });
      }

      if (loaded !== meta.size) {
        throw new Error('文件不完整：大小校验失败，已取消下载');
      }
      const actualHash = toHex(digest.digest());
      if (actualHash.toLowerCase() !== receiveHash.trim().toLowerCase()) {
        throw new Error('文件不完整：SHA-256 校验失败，已取消下载');
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

  const normalizedRelay = (() => {
    try { return normalizeRelayBase(relayBase); } catch { return ''; }
  })();
  const localRelay = (() => {
    if (!normalizedRelay) return false;
    try {
      const host = new URL(normalizedRelay).hostname;
      return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    } catch {
      return false;
    }
  })();
  const configIssue = !relayBase.trim()
    ? '请先填写 Relay 地址'
    : !normalizedRelay
      ? 'Relay 地址格式不正确，请填写完整 URL'
      : !localRelay && !normalizedRelay.startsWith('https://')
        ? '公网 Relay 必须使用 HTTPS；本地 127.0.0.1 才允许 HTTP'
        : !localRelay && !relayAccessToken.trim()
          ? '该公网 Relay 需要 access token；请向 Relay 部署者获取'
          : '';
  const relayReady = !configIssue;
  const canUpload = relayReady && Boolean(file) && !sending;
  const showTabs = !initialLink;
  const docsHref = 'https://github.com/8hourseontheleft6/Filebridge-Lan/blob/main/docs/CROSS-NETWORK.md';

  return (
    <section className={`panel relay-panel${standalone ? ' relay-panel-standalone' : ''}`}>
      <div className="panel-head">
        <h2>{initialLink ? '📥 跨网络中继（实验）· 接收' : '🌍 跨网络中继（实验）'}</h2>
        <span className="chip chip-warn">实验性</span>
      </div>

      <div className="relay-warning" role="note">
        <strong>实验性功能</strong>
        <p>
          目前只验证了同机/localhost，尚未完成手机蜂窝网络 + 电脑另一网络实测。
          请使用自建 HTTPS Relay，暂不要传输敏感文件。
        </p>
        <a href={docsHref} target="_blank" rel="noreferrer">查看部署和限制</a>
      </div>

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

      {tab === 'send' && !initialLink && (
        <ol className="relay-steps">
          <li className={`relay-step${relayReady ? ' done' : ' active'}`}>
            <div className="relay-step-head">
              <span className="relay-step-index">1</span>
              <strong>配置 Relay</strong>
              <span className={`pairing-state${relayReady ? ' ok' : ''}`}>
                {relayReady ? '配置完整' : '未配置'}
              </span>
            </div>
            <div className="relay-step-body">
              <label className="field-label" htmlFor="relay-base">Relay 地址</label>
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
              <label className="field-label" htmlFor="relay-access">Access token（公网 Relay 必填）</label>
              <input
                id="relay-access"
                className="input relay-key"
                value={relayAccessToken}
                onChange={(event) => {
                  const value = event.target.value.trim();
                  setRelayAccessToken(value);
                  try { window.localStorage.setItem(RELAY_ACCESS_KEY, value); } catch { /* ignore */ }
                }}
                placeholder="本地 127.0.0.1 Relay 可留空"
                spellCheck={false}
                autoComplete="off"
              />
              <p className={`hint${configIssue ? ' relay-error' : ''}`}>
                {configIssue || (localRelay
                  ? '本地 Relay 已配置；公网使用仍需 HTTPS 和 access token。'
                  : '公网 Relay 已配置；接收方会打开完整链接。')}
              </p>
            </div>
          </li>

          <li className={`relay-step${result ? ' done' : relayReady ? ' active' : ''}`}>
            <div className="relay-step-head">
              <span className="relay-step-index">2</span>
              <strong>选择并加密上传</strong>
              <span className="pairing-state">{file ? (sending ? '上传中' : '已选择') : '未选择'}</span>
            </div>
            <div className="relay-step-body">
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
                  disabled={!canUpload}
                >
                  {sending ? '加密上传中…' : '加密并上传'}
                </button>
              </div>
              {!relayReady && (
                <p className="hint relay-error">上传已禁用：{configIssue}</p>
              )}
              {file && (
                <p className="hint">
                  {file.name} · {formatBytes(file.size)}
                </p>
              )}
              <p className="relay-meta-warning">
                中继能看到文件名、大小、时间、IP 等元数据。上传完成后请发送完整链接，不要只发送 8 位传输码。
              </p>

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
                    <span>{file ? formatBytes(file.size) : ''}</span>
                    <span>{formatBytes(sendProgress.loaded)} / {formatBytes(sendProgress.total)}</span>
                    {sendSpeed > 0 && <span>{formatBytes(sendSpeed)}/s</span>}
                    {sendEta > 0 && <span>剩余 {formatDuration(sendEta)}</span>}
                    <button type="button" className="btn btn-small" onClick={cancelSend}>取消</button>
                  </div>
                </div>
              )}
              {sendError && <p className="text-error relay-error">{sendError}</p>}
            </div>
          </li>

          <li className={`relay-step${result ? ' active done' : ''}`}>
            <div className="relay-step-head">
              <span className="relay-step-index">3</span>
              <strong>生成完整接收链接</strong>
              <span className="pairing-state">{result ? '已生成' : '等待上传'}</span>
            </div>
            <div className="relay-step-body">
              {result ? (
                <div className="relay-result-highlight">
                  <div className="relay-link-primary">
                    <span>完整接收链接</span>
                    <CopyButton text={result.link} label="复制完整链接" />
                  </div>
                  <JoinQr
                    url={result.link}
                    displayUrl={result.link.replace(/([?&#](?:key|token|hash)=)[^&]+/g, '$1••••')}
                    title="手机扫码接收（跨网络）"
                    subtitle="接收方必须打开完整链接；不要只发送传输码"
                  />
                  <p className="relay-meta-warning">
                    中继可见文件名、大小、时间、IP 等元数据；完整链接包含解密 key 和 downloadToken，请通过可信渠道发送。
                  </p>
                  <details className="relay-details">
                    <summary>查看链接详情</summary>
                    <p>传输码：<code>{result.code}</code></p>
                    <p>文件名：{result.name}</p>
                    <p>大小：{formatBytes(result.size)} · 分片 {result.chunks} 个</p>
                    <p>有效至：{new Date(result.expiresAt).toLocaleString()}</p>
                    <p className="relay-key-wrap">SHA-256：{result.hash}</p>
                    <p className="relay-key-wrap">{result.link}</p>
                  </details>
                  <button type="button" className="btn btn-small" onClick={resetSend}>再传一个</button>
                </div>
              ) : (
                <p className="hint">完成第 2 步后，这里会出现二维码、完整链接和有效期。</p>
              )}
            </div>
          </li>
        </ol>
      )}

      {tab === 'receive' && (
        <div className="relay-receive">
          <p className="hint">
            收到完整链接时，传输码、解密 key 和 downloadToken 会自动填入；也可以手动粘贴。
          </p>
          <details className="relay-details relay-manual" open={!initialLink || undefined}>
            <summary>手动连接 / 查看链接详情</summary>
            <div className="relay-manual-body">
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
              <label className="field-label" htmlFor="relay-key">解密 key（链接 # 后）</label>
              <input
                id="relay-key"
                className="input relay-key"
                value={receiveKey}
                onChange={(event) => setReceiveKey(event.target.value.trim())}
                placeholder="完整链接会自动填入"
                spellCheck={false}
                autoComplete="off"
              />
              <label className="field-label" htmlFor="relay-token">downloadToken（链接 # 后）</label>
              <input
                id="relay-token"
                className="input relay-key"
                value={receiveToken}
                onChange={(event) => setReceiveToken(event.target.value.trim())}
                placeholder="完整链接会自动填入"
                spellCheck={false}
                autoComplete="off"
              />
              <label className="field-label" htmlFor="relay-hash">文件 SHA-256（链接 # 后）</label>
              <input
                id="relay-hash"
                className="input relay-key"
                value={receiveHash}
                onChange={(event) => setReceiveHash(event.target.value.trim())}
                placeholder="完整链接会自动填入"
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void loadMeta()}
                disabled={loadingMeta || !receiveCode.trim() || !receiveToken.trim()}
              >
                {loadingMeta ? '查询中…' : '查询文件'}
              </button>
            </div>
          </details>

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
