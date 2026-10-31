import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { HttpTransfer } from './http/HttpTransfer';
import { HostApprovalGate } from './http/HostApprovalGate';
import { RelayTransfer } from './relay/RelayTransfer';
import { SettingsPanel } from './components/SettingsPanel';
import { NetworkWarning } from './components/NetworkWarning';
import { isRelayHosted, parseRelayHash } from './relay/api';
import { isTauriHost } from './lib/hub';
import type { LanServiceStatus } from './lib/hub';

type TransferMode = 'lan' | 'relay';
type AppView = 'transfer' | 'settings';

export interface NetworkProfile {
  name: string;
  category: string;
  label: string;
}

export interface NetworkProfileStatus {
  checked: boolean;
  compliant: boolean;
  networks: NetworkProfile[];
  error?: string | null;
}

function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const update = () => setVisible(window.scrollY > 120);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  return (
    <button
      type="button"
      className={`back-to-top${visible ? ' visible' : ''}`}
      aria-label="回到页面顶部"
      title="回到顶部"
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
    >
      ↑
    </button>
  );
}

export default function App() {
  const [view, setView] = useState<AppView>('transfer');
  const [networkStatus, setNetworkStatus] = useState<NetworkProfileStatus | null>(null);
  const [lanServiceStatus, setLanServiceStatus] = useState<LanServiceStatus | null>(null);
  const [networkChecking, setNetworkChecking] = useState(false);
  const [networkDismissed, setNetworkDismissed] = useState(false);
  const gateSignatureRef = useRef('');
  const relayLink = parseRelayHash();
  const relayOnly = isRelayHosted();
  const [mode, setMode] = useState<TransferMode>(relayOnly ? 'relay' : 'lan');
  const activeMode: TransferMode = relayOnly ? 'relay' : mode;

  const checkNetwork = useCallback(async () => {
    if (!isTauriHost()) return;
    setNetworkChecking(true);
    try {
      const status = await invoke<NetworkProfileStatus>('network_profile_status');
      const signature = JSON.stringify([
        status.checked,
        status.compliant,
        status.error,
        status.networks,
      ]);
      if (gateSignatureRef.current !== signature) {
        gateSignatureRef.current = signature;
        setNetworkDismissed(false);
      }
      setNetworkStatus(status);
    } catch (reason) {
      setNetworkStatus({
        checked: false,
        compliant: false,
        networks: [],
        error: reason instanceof Error ? reason.message : String(reason),
      });
      setNetworkDismissed(false);
    }

    try {
      const service = await invoke<LanServiceStatus>('lan_service_refresh');
      setLanServiceStatus(service);
    } catch {
      setLanServiceStatus(null);
    } finally {
      setNetworkChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkNetwork();
    const timer = window.setInterval(() => { void checkNetwork(); }, 5000);
    return () => window.clearInterval(timer);
  }, [checkNetwork]);

  useEffect(() => {
    const keepAtTop = () => {
      if (window.scrollX !== 0) {
        window.scrollTo({ left: 0, top: window.scrollY });
      }
    };
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.scrollLeft !== 0) {
        target.scrollLeft = 0;
      }
      keepAtTop();
    };
    let startX = 0;
    let startY = 0;
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const dx = Math.abs(event.touches[0].clientX - startX);
      const dy = Math.abs(event.touches[0].clientY - startY);
      if (dx > dy) event.preventDefault();
    };
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        event.preventDefault();
      }
    };
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', keepAtTop);
    keepAtTop();
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', keepAtTop);
    };
  }, []);

  if (relayLink) {
    return (
      <div className="app receiver-page">
        <header className="receiver-header">
          <div className="brand">
            <span className="brand-mark">F</span>
            <div>
              <strong>Filebridge Lan</strong>
              <span>跨网络中继 · 实验性接收</span>
            </div>
          </div>
        </header>
        <main className="receiver-main">
          <RelayTransfer initialLink={relayLink} standalone />
        </main>
        <footer className="app-footer">Filebridge-Lan v1.5.3 · 实验性中继</footer>
        <BackToTop />
      </div>
    );
  }

  function scrollToGuide() {
    setView('transfer');
    window.setTimeout(() => {
      document.getElementById('transfer-guide')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  return (
    <div className="app app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">F</span>
          <div>
            <strong>Filebridge Lan</strong>
          </div>
        </div>

        <nav className="side-nav" aria-label="主导航">
          <button
            type="button"
            className={`side-nav-item${view === 'transfer' ? ' active' : ''}`}
            onClick={() => setView('transfer')}
          >
            <span className="side-nav-icon">↔</span>
            传输
          </button>
          <button type="button" className="side-nav-item" onClick={scrollToGuide}>
            <span className="side-nav-icon">?</span>
            使用说明
          </button>
          {activeMode === 'lan' && (
            <button
              type="button"
              className={`side-nav-item${view === 'settings' ? ' active' : ''}`}
              onClick={() => setView('settings')}
            >
              <span className="side-nav-icon">⚙</span>
              设置
            </button>
          )}
        </nav>

        <div className="sidebar-foot">
          <span className="sidebar-version">v1.5.3</span>
          <span className="sidebar-mode">{activeMode === 'lan' ? '局域网直传' : '跨网络中继 · 实验'}</span>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">
              {view === 'settings' ? 'PREFERENCES' : activeMode === 'lan' ? 'LOCAL TRANSFER' : 'EXPERIMENTAL RELAY'}
            </p>
            <h1>{view === 'settings' ? '设置' : activeMode === 'lan' ? '文件传输' : '跨网络中继'}</h1>
            <p className="topbar-subtitle">
              {view === 'settings'
                ? '下载目录与应用信息。'
                : activeMode === 'lan'
                  ? '同一 WiFi，手机扫码即可收发文件。'
                  : '自建 HTTPS Relay，端到端加密的跨网络传输。'}
            </p>
          </div>
          <div className="topbar-actions">
            {view === 'settings' ? (
              <button type="button" className="btn btn-ghost" onClick={() => setView('transfer')}>
                返回传输
              </button>
            ) : activeMode === 'lan' ? (
              <button type="button" className="btn btn-ghost" onClick={() => setView('settings')}>
                <span aria-hidden>⚙</span> 设置
              </button>
            ) : (
              <span className="status-pill warn">实验性</span>
            )}
          </div>
        </header>

        {view === 'transfer' && !relayOnly && (
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
              onClick={() => { setMode('relay'); setView('transfer'); }}
            >
              跨网络中继 <span className="mode-tag">实验</span>
            </button>
          </div>
        )}

        <main className="main home-main">
          {view === 'settings' ? (
            <SettingsPanel onClose={() => setView('transfer')} />
          ) : activeMode === 'lan' ? (
            <HttpTransfer
              lanService={lanServiceStatus}
              networkBlocked={Boolean(networkStatus && !networkStatus.compliant)}
            />
          ) : (
            <RelayTransfer />
          )}
        </main>

        <footer className="app-footer">Filebridge-Lan v1.5.3 · 局域网直传 / 实验性中继</footer>
      </div>

      <HostApprovalGate />
      <BackToTop />
      {isTauriHost() && networkStatus && !networkStatus.compliant && !networkDismissed && (
        <NetworkWarning
          status={networkStatus}
          retrying={networkChecking}
          onRetry={() => void checkNetwork()}
          onClose={() => setNetworkDismissed(true)}
        />
      )}
    </div>
  );
}
