import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isTauriHost } from '../lib/hub';

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
    ? (discovery.lastError || '发现服务启动失败')
    : error
      ? '发现服务不可用'
      : '';
  const sendTargetCount = discovery?.sendTargets?.length || 0;
  const lastError = discovery?.lastError;

  return (
    <article className="card nearby-card">
      <div className="card-head">
        <div>
          <h2>附近电脑</h2>
          <p>自动发现同一局域网内也打开 Filebridge 的电脑。</p>
        </div>
        <div className="card-actions">
          {peers.length > 0 && <span className="count-badge">{peers.length}</span>}
          <button type="button" className="btn btn-ghost btn-small" onClick={() => void refresh()}>
            刷新
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
          <span>暂时没有发现其他电脑。</span>
          <span>请确认双方在同一子网、Windows 网络为专用，并关闭 AP/客户端隔离。</span>
          {discovery?.bound && (
            <span className="nearby-diagnostic">
              UDP 42081 已监听 · {sendTargetCount} 个发送目标
            </span>
          )}
        </div>
      ) : (
        <div className="nearby-list">
          {peers.map((peer) => (
            <div className="nearby-row" key={peer.id}>
              <span className="nearby-icon" aria-hidden>▣</span>
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
          ))}
          <span className="nearby-diagnostic">
            UDP 42081 · {sendTargetCount} 个发送目标
          </span>
        </div>
      )}

      {!scanning && !serviceError && lastError && (
        <p className="nearby-warning">最近发现错误：{lastError}</p>
      )}
    </article>
  );
}
