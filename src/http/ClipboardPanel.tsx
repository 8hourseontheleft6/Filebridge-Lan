import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { useClipboardController } from '../features/clipboard/useClipboardController';

interface ClipboardPanelProps {
  token: string;
  desktop: boolean;
  online: boolean | null;
  publicPaused: boolean;
}

function formatTime(value: number | null) {
  if (!value) return '尚未同步';
  return new Date(value).toLocaleTimeString();
}

export function ClipboardPanel({ token, desktop, online, publicPaused }: ClipboardPanelProps) {
  const [draft, setDraft] = useState('');
  const controller = useClipboardController({
    token,
    desktop,
    online,
    publicPaused,
    hostname: window.location.hostname,
  });
  const {
    enabled,
    text,
    paused,
    canToggle,
    busy,
    copied,
    notice,
    error,
    resetKey,
  } = controller;

  // Session change / clear / auth failure must drop the local draft as well.
  useEffect(() => {
    setDraft('');
  }, [resetKey]);

  const status = !enabled
    ? '同步关闭'
    : paused
      ? '已暂停'
      : copied
        ? '已复制'
        : text
          ? '已连接'
          : '等待文本';

  const toggle = async () => {
    const next = await controller.toggle();
    if (!next) setDraft('');
  };

  const send = async (value: string) => {
    await controller.send(value);
  };

  const readClipboard = async () => {
    const value = await controller.readClipboard();
    if (value !== null) setDraft(value);
  };

  const clear = async () => {
    const cleared = await controller.clear();
    if (cleared) setDraft('');
  };

  return (
    <article className="card clipboard-card">
      <div className="card-head">
        <div>
          <h2>文字同步</h2>
          <p>
            {enabled
              ? '只在当前已批准连接内同步纯文本，内容只存内存、不写入磁盘。'
              : '开启后只同步纯文本，不写入磁盘。'}
          </p>
        </div>
        <div className="clipboard-head-status">
          <span className={`status-pill ${enabled ? (paused ? 'warn' : 'ok') : 'warn'}`}>{status}</span>
        </div>
      </div>

      {enabled && (
        <p className="clipboard-default-note">
          <Icon name="help" size={13} /> 默认开启，可随时关闭；只存内存，断线或关闭同步即清空。
        </p>
      )}

      {!enabled ? (
        <div className="clipboard-off">
          <p className="hint">手机需要主机先开启；浏览器剪贴板权限受限时，仍可手动输入或粘贴。</p>
          {canToggle ? (
            <button type="button" className="btn btn-primary btn-small" disabled={busy || paused} onClick={() => void toggle()}>
              {busy ? '处理中…' : '开启文字同步'}
            </button>
          ) : (
            <p className="hint">等待电脑端开启文字同步。</p>
          )}
        </div>
      ) : (
        <>
          <div className="clipboard-latest">
            <div className="clipboard-meta">
              <span>{formatTime(controller.snapshot?.updatedAt || null)}</span>
              <span>{controller.snapshot?.source === 'desktop' ? '来自电脑' : controller.snapshot?.source === 'phone' ? '来自手机' : '当前连接'}</span>
            </div>
            <pre className="clipboard-text" tabIndex={0}>{text || '暂无文本'}</pre>
            <div className="clipboard-actions">
              <button type="button" className="btn btn-small btn-primary" disabled={!text} onClick={() => void controller.copyLatest()}>
                <Icon name="copy" size={14} /> {copied ? '已复制' : '复制'}
              </button>
            </div>
          </div>
          <div className="clipboard-compose">
            <label className="field-label" htmlFor="clipboard-draft">发送文本</label>
            <textarea
              id="clipboard-draft"
              className="clipboard-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="粘贴或输入纯文本，然后发送到当前连接"
              rows={3}
            />
            <div className="clipboard-compose-actions">
              <span className="hint">{new TextEncoder().encode(draft).length} / {controller.maxBytes} bytes</span>
              <button type="button" className="btn btn-primary btn-small" disabled={busy || !draft} onClick={() => void send(draft)}>
                {busy ? '发送中…' : '发送'}
              </button>
            </div>
          </div>
          <div className="clipboard-quiet-actions">
            <button type="button" className="btn btn-small btn-ghost" onClick={() => void readClipboard()}>
              从剪贴板读取
            </button>
            <button type="button" className="btn btn-small btn-ghost" disabled={busy || !text} onClick={() => void clear()}>
              清空
            </button>
            {canToggle && (
              <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => void toggle()}>
                关闭同步
              </button>
            )}
          </div>
        </>
      )}

      {notice && <p className="clipboard-notice" role="status">{notice}</p>}
      {error && <p className="text-error clipboard-error" role="alert">{error}</p>}
    </article>
  );
}
