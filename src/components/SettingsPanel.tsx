import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isTauriHost } from '../lib/hub';

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const desktop = isTauriHost();
  const [savedDir, setSavedDir] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    invoke<string>('get_download_dir')
      .then((dir) => {
        if (!active) return;
        setSavedDir(dir);
        setDraft(dir);
      })
      .catch((reason) => {
        if (active) setError(`读取设置失败：${String(reason)}`);
      });
    return () => {
      active = false;
    };
  }, [desktop]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function chooseFolder() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const picked = await invoke<string | null>('pick_download_dir', {
        current: draft || savedDir,
      });
      if (picked) setDraft(picked);
    } catch (reason) {
      setError(`选择文件夹失败：${String(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const dir = await invoke<string>('set_download_dir', { path: draft });
      setSavedDir(dir);
      setDraft(dir);
      setMessage('已保存');
    } catch (reason) {
      setError(`保存失败：${String(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const dir = await invoke<string>('default_download_dir');
      setDraft(dir);
      setMessage('已恢复默认路径，点击“保存”生效');
    } catch (reason) {
      setError(`恢复默认失败：${String(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function openFolder() {
    setError('');
    try {
      await invoke('open_download_dir');
    } catch (reason) {
      setError(`打开文件夹失败：${String(reason)}`);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="modal-head">
          <h2 id="settings-title">⚙ 设置</h2>
          <button type="button" className="btn btn-small modal-close" onClick={onClose} aria-label="关闭设置">
            ✕
          </button>
        </div>

        {!desktop ? (
          <p className="hint">
            自定义下载路径只在桌面版可用；当前浏览器会使用浏览器默认下载目录。
          </p>
        ) : (
          <>
            <label className="field-label" htmlFor="download-dir">电脑端下载目录</label>
            <div className="path-row">
              <input
                id="download-dir"
                className="input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="例如 C:\Users\你\Downloads"
                spellCheck={false}
              />
              <button type="button" className="btn btn-small" onClick={() => void chooseFolder()} disabled={busy}>
                选择…
              </button>
            </div>
            <p className="hint">下载文件会复制到这里；同名且大小相同的文件不会重复下载。</p>
            <p className="hint">
              手机打不开？请确认 Windows 防火墙允许 Filebridge-Lan 访问“专用网络”；详见项目 README 的“手机打不开”一节。
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-small" onClick={() => void openFolder()} disabled={busy}>
                打开文件夹
              </button>
              <button type="button" className="btn btn-small" onClick={() => void reset()} disabled={busy}>
                恢复默认
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || !draft.trim()}>
                {busy ? '处理中…' : '保存'}
              </button>
            </div>
            {savedDir && <p className="hint">当前：{savedDir}</p>}
          </>
        )}

        {message && <p className="modal-message success">{message}</p>}
        {error && <p className="modal-message error">{error}</p>}

        <div className="about-card">
          <div className="about-head">
            <span className="about-mark">F</span>
            <div>
              <strong>Filebridge-Lan</strong>
              <span>版本 1.5.0 · 局域网文件传输</span>
            </div>
          </div>
          <p className="about-intro">
            手机扫码即可在同一 WiFi 下收发文件。所有文件只在本机处理，不经过 FileBridge 云端。
          </p>
          <dl className="about-facts">
            <div>
              <dt>传输</dt>
              <dd>HTTP 直传 · SHA-256 · Range 下载 · SSE 进度</dd>
            </div>
            <div>
              <dt>存储</dt>
              <dd>电脑 Downloads/Filebridge-Lan；保存时复制到下载目录</dd>
            </div>
            <div>
              <dt>安全</dt>
              <dd>局域网为 HTTP + 访问码；跨网络中继为实验性 AES-256-GCM 端到端加密</dd>
            </div>
          </dl>
          <p className="about-note">
            跨网络中继尚未完成真实 WAN 验证，请只在可信网络内使用局域网直传。
          </p>
          <a href="https://github.com/8hourseontheleft6/Filebridge-Lan" target="_blank" rel="noreferrer">
            GitHub 项目与更新
          </a>
        </div>
      </section>
    </div>
  );
}
