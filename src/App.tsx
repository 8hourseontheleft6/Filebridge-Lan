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
      <div className="app relay-receive-app">
        <header className="header home-header">
          <div className="home-title">
            <h1>📥 Filebridge-Lan</h1>
            <p className="status">跨网络中继（实验）· 接收</p>
          </div>
        </header>
        <main className="main relay-main">
          <RelayTransfer initialLink={relayLink} standalone />
        </main>
        <footer className="app-footer">Filebridge-Lan v1.4.0 · 实验性中继</footer>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header home-header">
        <div className="home-title">
          <h1>📁 Filebridge-Lan</h1>
          <p className="status">
            {activeMode === 'lan' ? '同一 WiFi · 免安装 · 大文件直传' : '跨网络中继（实验）'}
          </p>
        </div>
        {activeMode === 'lan' && (
          <button
            type="button"
            className="btn btn-small settings-button"
            onClick={() => setSettingsOpen(true)}
          >
            ⚙ 设置
          </button>
        )}
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
            跨网络中继（实验）
          </button>
        </div>
      )}

      <main className={`main home-main mode-${activeMode}`}>
        {activeMode === 'lan' ? <HttpTransfer /> : <RelayTransfer />}
      </main>

      <footer className="app-footer">Filebridge-Lan v1.4.0 · 局域网直传 / 实验性中继</footer>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
