import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { API_BASE } from '../lib/hub';
import { Icon } from '../components/Icon';

interface ClipboardSnapshot {
  enabled: boolean;
  text: string | null;
  hash: string | null;
  updatedAt: number | null;
  revision: number;
  source: string | null;
  maxBytes: number;
}

interface ClipboardPanelProps {
  token: string;
  desktop: boolean;
  online: boolean | null;
  publicPaused: boolean;
}

const MAX_BYTES = 256 * 1024;

function formatTime(value: number | null) {
  if (!value) return '尚未同步';
  return new Date(value).toLocaleTimeString();
}

async function sha256(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) return '';
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function ClipboardPanel({ token, desktop, online, publicPaused }: ClipboardPanelProps) {
  const [snapshot, setSnapshot] = useState<ClipboardSnapshot | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [systemReadBusy, setSystemReadBusy] = useState(false);
  const hashRef = useRef('');
  const lastSystemHashRef = useRef('');
  const syncingRef = useRef(false);
  const autoEnableRef = useRef(false);
  const enabled = Boolean(snapshot?.enabled);
  const text = snapshot?.text || '';
  const canEnable = desktop || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname);
  const paused = publicPaused || online === false || online === null;

  const headers = useCallback(() => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }), [token]);

  const applySnapshot = useCallback((next: ClipboardSnapshot) => {
    setSnapshot(next);
    hashRef.current = next.hash || '';
    if (!next.enabled) {
      setError('');
    }
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(`${API_BASE}/api/clipboard`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      applySnapshot(await response.json() as ClipboardSnapshot);
    } catch {
      if (!publicPaused && online !== false) setError('暂时无法读取文字同步状态');
    }
  }, [applySnapshot, online, publicPaused, token]);

  useEffect(() => {
    if (!token || publicPaused || online === false) {
      setSnapshot((prev) => prev ? { ...prev, text: '', hash: null, updatedAt: null, source: null } : prev);
      return;
    }
    void load();
    const timer = window.setInterval(() => { void load(); }, 2000);
    return () => window.clearInterval(timer);
  }, [load, online, publicPaused, token]);

  // Desktop reads the system clipboard only while sync is enabled, the window
  // is focused, the connection is online, and no other sync is in flight.
  useEffect(() => {
    if (!desktop || !enabled || paused) return;
    let active = true;
    const pullSystem = async () => {
      if (!active || syncingRef.current || !document.hasFocus()) return;
      syncingRef.current = true;
      try {
        const value = await invoke<string | null>('clipboard_read_text');
        if (!active || !value) return;
        const hash = await sha256(value);
        if (!hash || hash === hashRef.current || hash === lastSystemHashRef.current) return;
        const response = await fetch(`${API_BASE}/api/clipboard`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ text: value, source: 'desktop' }),
        });
        const next = await response.json() as ClipboardSnapshot & { code?: string };
        if (!response.ok) {
          setError(next.code === 'clipboard_rate_limited' ? '文字同步过于频繁，请稍后再试' : '系统剪贴板同步失败');
          return;
        }
        lastSystemHashRef.current = hash;
        applySnapshot(next);
      } catch (reason) {
        if (active) setError(`读取系统剪贴板失败：${String(reason)}`);
      } finally {
        syncingRef.current = false;
      }
    };
    void pullSystem();
    const timer = window.setInterval(() => { void pullSystem(); }, 2500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [applySnapshot, desktop, enabled, headers, paused]);

  // Phone-to-desktop direction: write only when the Hub text came from another
  // source, and remember the hash so the system poll does not echo it back.
  useEffect(() => {
    if (!desktop || !enabled || paused || !text || !snapshot?.hash) return;
    if (snapshot.source === 'desktop') return;
    if (snapshot.hash === lastSystemHashRef.current) return;
    void invoke('clipboard_write_text', { text })
      .then(() => {
        lastSystemHashRef.current = snapshot.hash || '';
      })
      .catch((reason) => {
        setError(`写入系统剪贴板失败：${String(reason)}`);
      });
  }, [desktop, enabled, paused, snapshot?.hash, snapshot?.source, text]);

  const toggle = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${API_BASE}/api/clipboard/enabled`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ enabled: !enabled }),
      });
      const next = await response.json() as ClipboardSnapshot & { error?: string };
      if (!response.ok) throw new Error(next.error || '切换文字同步失败');
      applySnapshot(next);
      if (!next.enabled) setDraft('');
      setNotice(next.enabled ? '文字同步已开启' : '文字同步已关闭');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  // Desktop default: enable once when the approved session becomes ready.
  // A later manual disable is respected because this ref is never reset.
  useEffect(() => {
    if (!desktop || !canEnable || paused || !snapshot || snapshot.enabled || autoEnableRef.current) return;
    autoEnableRef.current = true;
    void toggle();
  }, [canEnable, desktop, paused, snapshot?.enabled]);

  const send = async (value: string, source: 'desktop' | 'phone' = desktop ? 'desktop' : 'phone') => {
    const body = value;
    if (!body) {
      setError('文本不能为空');
      return;
    }
    if (new TextEncoder().encode(body).length > MAX_BYTES) {
      setError('文本超过 256 KiB 限制');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${API_BASE}/api/clipboard`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ text: body, source }),
      });
      const next = await response.json() as ClipboardSnapshot & { error?: string; code?: string };
      if (!response.ok) {
        if (next.code === 'clipboard_too_large') throw new Error('文本超过 256 KiB 限制');
        if (next.code === 'clipboard_disabled') throw new Error('文字同步未开启');
        if (next.code === 'clipboard_rate_limited') throw new Error('文字同步过于频繁，请稍后再试');
        throw new Error(next.error || '发送失败');
      }
      applySnapshot(next);
      if (source === 'desktop') lastSystemHashRef.current = next.hash || '';
      setNotice('已发送到当前连接');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const copyLatest = async () => {
    if (!text) return;
    setError('');
    try {
      if (desktop) {
        await invoke('clipboard_write_text', { text });
      } else {
        if (!navigator.clipboard?.writeText) throw new Error('当前浏览器不允许自动复制');
        await navigator.clipboard.writeText(text);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('浏览器未允许自动复制，请长按/选择文本手动复制');
    }
  };

  const readClipboard = async () => {
    setError('');
    setNotice('');
    try {
      if (desktop) {
        const value = await invoke<string | null>('clipboard_read_text');
        if (value == null) throw new Error('系统剪贴板没有文本');
        setDraft(value);
        setNotice('已读取系统剪贴板，可点击发送');
        return;
      }
      if (!navigator.clipboard?.readText) throw new Error('当前浏览器不允许读取剪贴板');
      const value = await navigator.clipboard.readText();
      if (!value) throw new Error('浏览器剪贴板为空');
      setDraft(value);
      setNotice('已读取剪贴板，可点击发送');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取剪贴板，请手动粘贴');
    }
  };

  const clear = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/api/clipboard`, {
        method: 'DELETE',
        headers: headers(),
      });
      const next = await response.json() as ClipboardSnapshot;
      if (!response.ok) throw new Error('清空失败');
      applySnapshot(next);
      setDraft('');
      setNotice('当前文本已清空');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const status = !enabled
    ? '同步关闭'
    : paused
      ? '已暂停'
      : copied
        ? '已复制'
        : text
          ? '已连接'
          : '等待文本';

  return (
    <article className="card clipboard-card">
      <div className="card-head">
        <div>
          <h2>文字同步</h2>
          <p>{enabled ? '仅在当前已批准连接内交换纯文本。' : '默认关闭；开启后只同步纯文本，不写入磁盘。'}</p>
        </div>
        <span className={`status-pill ${enabled ? (paused ? 'warn' : 'ok') : 'warn'}`}>{status}</span>
      </div>

      {!enabled ? (
        <div className="clipboard-off">
          <p className="hint">手机需要主机先开启；浏览器剪贴板权限受限时，仍可手动输入或粘贴。</p>
          {canEnable ? (
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
              <span>{formatTime(snapshot?.updatedAt || null)}</span>
              <span>{snapshot?.source === 'desktop' ? '来自电脑' : snapshot?.source === 'phone' ? '来自手机' : '当前连接'}</span>
            </div>
            <pre className="clipboard-text" tabIndex={0}>{text || '暂无文本'}</pre>
            <div className="clipboard-actions">
              <button type="button" className="btn btn-small" disabled={!text} onClick={() => void copyLatest()}>
                <Icon name="copy" size={14} /> {copied ? '已复制' : '复制'}
              </button>
              <button type="button" className="btn btn-small btn-ghost" onClick={() => void readClipboard()}>
                从剪贴板读取
              </button>
              <button type="button" className="btn btn-small btn-ghost" disabled={busy || !text} onClick={() => void clear()}>
                清空
              </button>
              {canEnable && (
                <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => void toggle()}>
                  关闭同步
                </button>
              )}
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
              <span className="hint">{new TextEncoder().encode(draft).length} / {MAX_BYTES} bytes</span>
              <button type="button" className="btn btn-primary btn-small" disabled={busy || !draft} onClick={() => void send(draft)}>
                {busy ? '发送中…' : '发送'}
              </button>
            </div>
          </div>
        </>
      )}

      {notice && <p className="clipboard-notice" role="status">{notice}</p>}
      {error && <p className="text-error clipboard-error" role="alert">{error}</p>}
    </article>
  );
}
