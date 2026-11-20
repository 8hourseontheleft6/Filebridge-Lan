import { useEffect, useState } from 'react';
import { useSettings } from '../features/settings/useSettings';
import { InfoTip } from './InfoTip';
import { Icon } from './Icon';
import { BrandMark } from './BrandMark';

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const settings = useSettings();
  const [aboutOpen, setAboutOpen] = useState(false);
  const { desktop, draft, busy, message, error } = settings;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <article className="card settings-section">
        <div className="card-head">
          <div>
            <h2>下载目录</h2>
            <p>选择保存文件时使用的电脑目录。</p>
          </div>
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
                onChange={(event) => settings.setDraft(event.target.value)}
                placeholder="例如 C:\Users\你\Downloads"
                spellCheck={false}
              />
              <button type="button" className="btn btn-small" onClick={() => void settings.chooseFolder()} disabled={busy}>
                选择…
              </button>
            </div>
            <p className="hint settings-note">
              保存时复制到指定目录
              <InfoTip text="同名且大小相同的文件不会重复下载。手机打不开时，请确认 Windows 防火墙允许 Filebridge-Lan 访问专用网络；详见项目 README 的“手机打不开”一节。" />
            </p>
            <div className="settings-actions">
              <button type="button" className="btn btn-small" onClick={() => void settings.openFolder()} disabled={busy}>
                打开文件夹
              </button>
              <button type="button" className="btn btn-small" onClick={() => void settings.reset()} disabled={busy}>
                恢复默认
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void settings.save()} disabled={busy || !draft.trim()}>
                {busy ? '处理中…' : '保存'}
              </button>
            </div>
          </>
        )}

        {message && (
          <p className="modal-message success" role="status">
            <Icon name="check" size={14} /> {message}
          </p>
        )}
        {error && (
          <p className="modal-message error" role="alert">
            <Icon name="alert" size={14} /> {error}
          </p>
        )}
      </article>

      <article className="card about-card settings-about">
        <div className="about-head">
          <BrandMark variant="app" size={38} className="about-mark" />
          <div>
            <strong>Filebridge-Lan</strong>
            <span>版本 1.6.1</span>
          </div>
          <button
            type="button"
            className="btn btn-small"
            aria-expanded={aboutOpen}
            onClick={() => setAboutOpen((value) => !value)}
          >
            {aboutOpen ? '收起' : '详细信息'}
          </button>
        </div>

        {aboutOpen && (
          <div className="about-details">
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
            <button type="button" className="about-link" onClick={() => void settings.openProject()}>
              GitHub 项目与更新 ↗
            </button>
          </div>
        )}
      </article>
    </section>
  );
}
