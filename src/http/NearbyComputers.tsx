import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isTauriHost } from '../lib/hub';
import { Icon } from '../components/Icon';

export interface NearbyPeer {
  id: string;
  name: string;
  ip: string;
  port: number;
  version: string;
  url: string;
}

export interface DiscoveryStatus {
  status: 'starting' | 'listening' | 'error' | string;
  bound: boolean;
  bindAddress?: string | null;
  sendTargets: string[];
  lastSendAt?: number | null;
  lastReceiveAt?: number | null;
  currentError?: string | null;
  lastError?: string | null;
  peerCount: number;
}

interface NearbyComputersProps {
  onConnect: (peer: NearbyPeer) => void;
  activePeerId?: string | null;
  activeState?: 'waiting' | 'connected';
}

export function NearbyComputers({ onConnect, activePeerId = null, activeState = 'waiting' }: NearbyComputersProps) {
  const desktop = isTauriHost();
  const [peers, setPeers] = useState<NearbyPeer[]>([]);
  const [discovery, setDiscovery] = useState<DiscoveryStatus | null>(null);
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState('');
  const [refreshSpinning, setRefreshSpinning] = useState(false);
  const refreshSpinTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (refreshSpinTimerRef.current !== null) window.clearTimeout(refreshSpinTimerRef.current);
  }, []);

  const spinRefresh = () => {
    if (refreshSpinTimerRef.current !== null) window.clearTimeout(refreshSpinTimerRef.current);
    setRefreshSpinning(false);
    window.requestAnimationFrame(() => setRefreshSpinning(true));
    refreshSpinTimerRef.current = window.setTimeout(() => {
      setRefreshSpinning(false);
      refreshSpinTimerRef.current = null;
    }, 620);
  };

  const refresh = useCallback(async () => {
    if (!desktop) return;
    try {
      const [result, status] = await Promise.all([
        invoke<NearbyPeer[]>('discovery_peers'),
        invoke<DiscoveryStatus>('discovery_status'),
      ]);
      setPeers(Array.isArray(result) ? result : []);
      setDiscovery(status);
      setScanning(status?.status === 'starting');
      setError('');
    } catch (reason) {
      setError(String(reason));
      setScanning(false);
    }
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => window.clearInterval(timer);
  }, [desktop, refresh]);

  if (!desktop) return null;

  const serviceError = discovery?.status === 'error'
    ? (discovery.currentError || discovery.lastError || '发现服务启动失败')
    : error
      ? '发现服务不可用'
      : '';
  const currentError = discovery?.currentError;

  return (
    <article className="card nearby-card">
      <div className="card-head">
        <div>
          <h2>附近电脑</h2>
          <p>自动发现同网段的 Filebridge 电脑。</p>
        </div>
        <div className="card-actions">
          {peers.length > 0 && <span className="count-badge">{peers.length}</span>}
          <button
            type="button"
            className="btn btn-ghost btn-icon-round"
            aria-label="刷新附近电脑"
            title="刷新"
            onClick={() => { spinRefresh(); void refresh(); }}
          >
            <Icon name="refresh" size={14} className={refreshSpinning ? 'is-spinning' : undefined} />
          </button>
        </div>
      </div>

      {scanning ? (
        <div className="nearby-empty">
          <span className="loading-dot" />
          <span>正在启动发现服务…</span>
        </div>
      ) : serviceError ? (
        <div className="nearby-empty nearby-error">
          <span>{serviceError}</span>
          <span>请用局域网 IP、扫码或手动配对继续。</span>
        </div>
      ) : peers.length === 0 ? (
        <div className="nearby-empty">
          <span>暂未发现其他电脑 · 确认同一子网且为专用网络</span>
        </div>
      ) : (
        <div className="nearby-list">
          {peers.map((peer) => (
            <div className="reveal" key={peer.id}>
              <div className="nearby-row">
                <span className="nearby-icon" aria-hidden><Icon name="device" size={16} /></span>
                <div className="nearby-main">
                  <strong>{peer.name}</strong>
                  <span>{peer.ip}:{peer.port} · v{peer.version}</span>
                </div>
                {activePeerId === peer.id ? (
                  <span className={`nearby-state ${activeState}`}>
                    {activeState === 'connected' ? '已连接' : '等待确认…'}
                  </span>
                ) : (
                  <button type="button" className="btn btn-primary btn-small" onClick={() => onConnect(peer)}>
                    连接
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!scanning && !serviceError && currentError && (
        <p className="nearby-warning">当前发现错误：{currentError}</p>
      )}
    </article>
  );
}
