import { useState } from 'react';
import { HttpTransfer } from './http/HttpTransfer';
import { RelayTransfer } from './relay/RelayTransfer';
import { SettingsPanel } from './components/SettingsPanel';
import { isRelayHosted, parseRelayHash } from './relay/api';

type TransferMode = 'lan' | 'relay';

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const relayLink = parseRelayHash();
  const relayOnly = isRelayHosted();
  const [mode, setMode] = useState<TransferMode>(relayOnly ? 'relay' : 'lan');
  const activeMode: TransferMode = relayOnly ? 'relay' : mode;

  if (relayLink) {
    return (
      <div className="app receiver-page">
        <header className="receiver-header">
          <div className="brand">
            <span className="brand-mark">F</span>
            <div>
              <strong>Filebridge-Lan</strong>
              <span>跨网络中继 · 实验性接收</span>
            </div>
          </div>
        </header>
        <main className="receiver-main">
          <RelayTransfer initialLink={relayLink} standalone />
        </main>
        <footer className="app-footer">Filebridge-Lan v1.5.0 · 实验性中继</footer>
      </div>
    );
  }

  function scrollToGuide() {
    document.getElementById('transfer-guide')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="app app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">F</span>
          <div>
            <strong>Filebridge</strong>
            <span>Lan Transfer</span>
          </div>
        </div>

        <nav className="side-nav" aria-label="主导航">
          <button type="button" className="side-nav-item active">
            <span className="side-nav-icon">↔</span>
            传输
          </button>
          <button type="button" className="side-nav-item" onClick={scrollToGuide}>
            <span className="side-nav-icon">?</span>
            使用说明
          </button>
          {activeMode === 'lan' && (
            <button type="button" className="side-nav-item" onClick={() => setSettingsOpen(true)}>
              <span className="side-nav-icon">⚙</span>
              设置
            </button>
          )}
        </nav>

        <div className="sidebar-foot">
          <span className="sidebar-version">v1.5.0</span>
          <span className="sidebar-mode">{activeMode === 'lan' ? '局域网直传' : '跨网络中继 · 实验'}</span>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{activeMode === 'lan' ? 'LOCAL TRANSFER' : 'EXPERIMENTAL RELAY'}</p>
            <h1>{activeMode === 'lan' ? '文件传输' : '跨网络中继'}</h1>
            <p className="topbar-subtitle">
              {activeMode === 'lan'
                ? '同一 WiFi，手机扫码即可收发文件。'
                : '自建 HTTPS Relay，端到端加密的跨网络传输。'}
            </p>
          </div>
          <div className="topbar-actions">
            {activeMode === 'lan' ? (
              <button type="button" className="btn btn-ghost" onClick={() => setSettingsOpen(true)}>
                <span aria-hidden>⚙</span> 设置
              </button>
            ) : (
              <span className="status-pill warn">实验性</span>
            )}
          </div>
        </header>

        {!relayOnly && (
          <div className="mode-switch" role="tablist" aria-label="传输模式">
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === 'lan'}
              className={`mode-tab${activeMode === 'lan' ? ' active' : ''}`}
              onClick={() => setMode('lan')}
            >
              局域网直传
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === 'relay'}
              className={`mode-tab${activeMode === 'relay' ? ' active' : ''}`}
              onClick={() => setMode('relay')}
            >
              跨网络中继 <span className="mode-tag">实验</span>
            </button>
          </div>
        )}

        <main className="main home-main">
          {activeMode === 'lan' ? <HttpTransfer /> : <RelayTransfer />}
        </main>

        <footer className="app-footer">Filebridge-Lan v1.5.0 · 局域网直传 / 实验性中继</footer>
      </div>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
