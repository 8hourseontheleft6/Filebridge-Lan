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
  const desktopApp = isTauriHost();
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
          {!relayOnly && <span className="side-nav-group" aria-hidden>传输方式</span>}
          {!relayOnly && (
            <button
              type="button"
              className={`side-nav-item${view === 'transfer' && activeMode === 'lan' ? ' active' : ''}`}
              aria-current={view === 'transfer' && activeMode === 'lan' ? 'page' : undefined}
              onClick={() => { setMode('lan'); setView('transfer'); }}
            >
              <span className="side-nav-icon"><Icon name="transfer" size={17} /></span>
              <span className="side-nav-label">局域网直传</span>
            </button>
          )}
          {/* The relay is experimental and desktop-only; it is also hidden on narrow layouts. */}
          {desktopApp && (
            <button
              type="button"
              className={`side-nav-item side-nav-item-muted${view === 'transfer' && activeMode === 'relay' ? ' active' : ''}`}
              aria-current={view === 'transfer' && activeMode === 'relay' ? 'page' : undefined}
              onClick={() => { setMode('relay'); setView('transfer'); }}
            >
              <span className="side-nav-icon"><Icon name="arrow-up-right" size={17} /></span>
              <span className="side-nav-label">跨网络中继</span>
              <span className="side-nav-badge">实验</span>
            </button>
          )}

          <span className="side-nav-group" aria-hidden>应用</span>
          <button type="button" className="side-nav-item" ref={helpTriggerRef} onClick={openHelp} aria-haspopup="dialog">
            <span className="side-nav-icon"><Icon name="help" size={17} /></span>
            <span className="side-nav-label">使用说明</span>
          </button>
          {activeMode === 'lan' && (
            <button
              type="button"
              className={`side-nav-item${view === 'settings' ? ' active' : ''}`}
              aria-current={view === 'settings' ? 'page' : undefined}
              onClick={() => setView('settings')}
            >
              <span className="side-nav-icon"><Icon name="settings" size={17} /></span>
              <span className="side-nav-label">设置</span>
            </button>
          )}
        </nav>

        <div className="sidebar-foot">
          <span className="sidebar-version">v1.6.0 Preview 3</span>
          {!desktopApp && <span className="sidebar-mode">浏览器访问</span>}
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <h1 className={view === 'settings' ? 'settings-title' : undefined}>{view === 'settings' ? '设置' : activeMode === 'lan' ? '文件传输' : '跨网络中继'}</h1>
            {view === 'settings' && <p className="topbar-subtitle">下载目录与应用信息。</p>}
            {view !== 'settings' && activeMode === 'relay' && (
              <p className="topbar-subtitle">自建 HTTPS Relay，端到端加密的跨网络传输。</p>
            )}
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

        {view === 'transfer' && activeMode === 'relay' && (
          <p className="mode-notice" role="note">
            跨网络中继仍是实验性功能：需要自建 HTTPS Relay，未完成真实 WAN 验证。
            <button type="button" className="mode-notice-action" onClick={() => setMode('lan')}>
              返回局域网直传
            </button>
          </p>
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
                <p>扫码、选文件、保存，几步就能传完。</p>
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
            <ol className="help-steps">
              <li>
                <div>
                  <strong>连上同一个局域网</strong>
                  <p>电脑打开应用，保持默认的「局域网直传」；手机或其他电脑连同一个 WiFi / 网段。</p>
                </div>
              </li>
              <li>
                <div>
                  <strong>手机扫码打开</strong>
                  <p>用手机扫「扫码连接」里的二维码，配对码会自动带入。扫不了就展开「手动连接 / 连接详情」，输入 6 位配对码。</p>
                </div>
              </li>
              <li>
                <div>
                  <strong>选择要传的文件</strong>
                  <p>手机上点「选择文件」，可一次选多个；电脑上把文件拖到窗口任意位置，或点文件列表右上角的 +。</p>
                </div>
              </li>
              <li>
                <div>
                  <strong>保存到本机</strong>
                  <p>电脑端点文件右侧「保存」，手机端点文件右侧的下载图标。文件默认在 <code>Downloads/Filebridge-Lan</code>，可在设置里改下载目录。</p>
                </div>
              </li>
              <li>
                <div>
                  <strong>看进度，可取消重试</strong>
                  <p>上传、接收、保存的进度和速度显示在右侧「上传」「下载」卡片里。传输中点圆形取消按钮，取消后点同位置的刷新按钮重新上传。</p>
                </div>
              </li>
              <li>
                <div>
                  <strong>可选：电脑互传与文字同步</strong>
                  <p>同网段的电脑会出现在「附近电脑」，点「连接」后需在对方电脑上批准；打开「文字同步」可在已批准连接之间互发纯文本。</p>
                </div>
              </li>
            </ol>
            <p className="security-note">
              只在专用网络可用：切到公用网络会暂停局域网服务。局域网直传是 HTTP 明文、只有访问码保护，不做内容加密；
              跨网络中继是实验性的 AES-256-GCM。
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
