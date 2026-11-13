import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { HttpTransfer } from './http/HttpTransfer';
import { HostApprovalGate } from './http/HostApprovalGate';
import { RelayTransfer } from './relay/RelayTransfer';
import { SettingsPanel } from './components/SettingsPanel';
import { NetworkWarning } from './components/NetworkWarning';
import { Icon } from './components/Icon';
import { BrandMark } from './components/BrandMark';
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
  const desktop = isTauriHost();
  const [view, setView] = useState<AppView>('transfer');
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpClosing, setHelpClosing] = useState(false);
  const helpCloseTimerRef = useRef<number | null>(null);
  const helpDialogRef = useRef<HTMLElement | null>(null);
  const helpTriggerRef = useRef<HTMLButtonElement | null>(null);
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
            <BrandMark tone="inverse" size={30} />
            <div>
              <strong>Filebridge Lan</strong>
              <span>跨网络中继 · 实验性接收</span>
            </div>
          </div>
        </header>
        <main className="receiver-main">
          <RelayTransfer initialLink={relayLink} standalone />
        </main>
        <footer className="app-footer">Filebridge-Lan</footer>
        <BackToTop />
      </div>
    );
  }

  const closeHelp = useCallback(() => {
    if (helpCloseTimerRef.current !== null) return;
    setHelpClosing(true);
    helpCloseTimerRef.current = window.setTimeout(() => {
      setHelpOpen(false);
      setHelpClosing(false);
      helpCloseTimerRef.current = null;
      window.requestAnimationFrame(() => helpTriggerRef.current?.focus());
    }, 180);
  }, []);

  const openHelp = useCallback(() => {
    if (helpCloseTimerRef.current !== null) {
      window.clearTimeout(helpCloseTimerRef.current);
      helpCloseTimerRef.current = null;
    }
    setHelpClosing(false);
    setHelpOpen(true);
  }, []);

  useEffect(() => () => {
    if (helpCloseTimerRef.current !== null) {
      window.clearTimeout(helpCloseTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!helpOpen) return;
    const dialog = helpDialogRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeHelp();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((node) => node.getClientRects().length > 0);
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [closeHelp, helpOpen]);

  return (
    <div className="app app-shell" inert={helpOpen || undefined} aria-hidden={helpOpen || undefined}>
      <aside className="sidebar">
        <div className="brand">
          <BrandMark tone="ink" size={30} />
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
            <span className="side-nav-icon"><Icon name="transfer" size={17} /></span>
            <span className="side-nav-label">传输</span>
          </button>
          <button type="button" className="side-nav-item" ref={helpTriggerRef} onClick={openHelp} aria-haspopup="dialog">
            <span className="side-nav-icon"><Icon name="help" size={17} /></span>
            <span className="side-nav-label">使用说明</span>
          </button>
          {activeMode === 'lan' && (
            <button
              type="button"
              className={`side-nav-item${view === 'settings' ? ' active' : ''}`}
              onClick={() => setView('settings')}
            >
              <span className="side-nav-icon"><Icon name="settings" size={17} /></span>
              <span className="side-nav-label">设置</span>
            </button>
          )}
        </nav>

        <div className="sidebar-foot">
          <span className="sidebar-version">v1.6.0 Preview 1</span>
          <span className="sidebar-mode">{activeMode === 'lan' ? '局域网直传' : '跨网络中继 · 实验'}</span>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <h1 className={view === 'settings' ? 'settings-title' : undefined}>{view === 'settings' ? '设置' : activeMode === 'lan' ? '文件传输' : '跨网络中继'}</h1>
            <p className="topbar-subtitle">
              {view === 'settings'
                ? '下载目录与应用信息。'
                : activeMode === 'lan'
                  ? desktop
                    ? '同一 WiFi，手机扫码即可收发文件。'
                    : '在同一 WiFi 下，与电脑互传文件。'
                  : '自建 HTTPS Relay，端到端加密的跨网络传输。'}
            </p>
          </div>
          <div className="topbar-actions">
            {view === 'settings' ? (
              <button type="button" className="btn btn-ghost" onClick={() => setView('transfer')}>
                返回传输
              </button>
            ) : activeMode === 'relay' ? (
              <span className="status-pill warn">实验性</span>
            ) : null}
          </div>
        </header>

        {view === 'transfer' && !relayOnly && (
          <div className="mode-switch" role="group" aria-label="传输模式">
            <button
              type="button"
              aria-pressed={activeMode === 'lan'}
              className={`mode-tab${activeMode === 'lan' ? ' active' : ''}`}
              onClick={() => setMode('lan')}
            >
              局域网直传
            </button>
            <button
              type="button"
              aria-pressed={activeMode === 'relay'}
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

        <footer className="app-footer">Filebridge-Lan</footer>
      </div>

      {helpOpen && createPortal(
        <div
          className={`help-overlay${helpClosing ? ' is-closing' : ''}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeHelp();
          }}
        >
          <section ref={helpDialogRef} className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title">
            <div className="help-head">
              <div>
                <h2 id="help-title">使用说明</h2>
                <p>文件列表、扫码连接、传输进度分别负责什么。</p>
              </div>
              <button
                type="button"
                className="btn btn-icon help-close"
                aria-label="关闭使用说明"
                autoFocus
                onClick={closeHelp}
              >
                <Icon name="close" size={15} />
              </button>
            </div>
            <div className="guide-grid">
              <div>
                <h3>文件列表</h3>
                <p>在这里选择、拖入、勾选批量保存或删除文件。手机上传的文件会先写入电脑的数据目录。</p>
              </div>
              <div>
                <h3>扫码连接</h3>
                <p>同一 WiFi 下让手机扫码，配对码会自动带入；扫码失败时可展开手动连接。</p>
              </div>
              <div>
                <h3>进度与速率</h3>
                <p>上传、接收和保存时的实时进度、速度与剩余时间都会显示在传输进度卡中。</p>
              </div>
            </div>
            <p className="security-note">
              存储位置：电脑的 <code>Downloads/Filebridge-Lan</code>；点击保存后复制到下载目录。
              局域网直传目前是 HTTP 明文，只有访问码保护，不做内容加密；跨网络中继才是 AES-256-GCM 实验性端到端加密。
            </p>
          </section>
        </div>,
        document.body,
      )}

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
