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

interface NearbyComputersProps {
  onConnect: (peer: NearbyPeer) => void;
}

export function NearbyComputers({ onConnect }: NearbyComputersProps) {
  const desktop = isTauriHost();
  const [peers, setPeers] = useState<NearbyPeer[]>([]);
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!desktop) return;
    try {
      const result = await invoke<NearbyPeer[]>('discovery_peers');
      setPeers(Array.isArray(result) ? result : []);
      setError('');
    } catch (reason) {
      setError(String(reason));
    } finally {
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
          <span>正在搜索附近的电脑…</span>
        </div>
      ) : error ? (
        <div className="nearby-empty nearby-error">
          <span>发现服务不可用。</span>
          <span>请用局域网 IP、扫码或手动配对继续。</span>
        </div>
      ) : peers.length === 0 ? (
        <div className="nearby-empty">
          <span>暂时没有发现其他电脑。</span>
          <span>请确认另一台电脑也打开了 Filebridge，并在同一局域网。</span>
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
              <button type="button" className="btn btn-primary btn-small" onClick={() => onConnect(peer)}>
                连接
              </button>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
