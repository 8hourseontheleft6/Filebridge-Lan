import { isTauriHost } from '../platform/runtime';
import { usePresenceList } from '../lib/usePresence';
import { Icon } from '../components/Icon';
import { useNearbyComputers } from '../features/connection/useNearbyComputers';
import type { NearbyPeer } from '../features/connection/types';

interface NearbyComputersProps {
  onConnect: (peer: NearbyPeer) => void;
  activePeerId?: string | null;
  activeState?: 'waiting' | 'connected';
}

export function NearbyComputers({ onConnect, activePeerId = null, activeState = 'waiting' }: NearbyComputersProps) {
  const desktop = isTauriHost();
  const controller = useNearbyComputers(desktop);
  const peerRows = usePresenceList(controller.peers, (peer) => peer.id);

  if (!desktop) return null;

  const serviceError = controller.discovery?.status === 'error'
    ? (controller.discovery.currentError || controller.discovery.lastError || '发现服务启动失败')
    : controller.error
      ? '发现服务不可用'
      : '';
  const currentError = controller.discovery?.currentError;

  return (
    <article className="card nearby-card">
      <div className="card-head">
        <div>
          <h2>附近电脑</h2>
          <p>自动发现同网段的 Filebridge 电脑。</p>
        </div>
        <div className="card-actions">
          {controller.peers.length > 0 && <span className="count-badge">{controller.peers.length}</span>}
          <button
            type="button"
            className="btn btn-ghost btn-icon-round"
            aria-label="刷新附近电脑"
            title="刷新"
            onClick={() => { controller.spinRefresh(); void controller.refresh(); }}
          >
            <Icon name="refresh" size={14} className={controller.spinning ? 'is-spinning' : undefined} />
          </button>
        </div>
      </div>

      {controller.scanning ? (
        <div className="nearby-empty">
          <span className="loading-dot" />
          <span>正在启动发现服务…</span>
        </div>
      ) : serviceError ? (
        <div className="nearby-empty nearby-error">
          <span>{serviceError}</span>
          <span>请用局域网 IP、扫码或手动配对继续。</span>
        </div>
      ) : controller.peers.length === 0 && peerRows.length === 0 ? (
        <div className="nearby-empty">
          <span>暂未发现其他电脑 · 确认同一子网且为专用网络</span>
        </div>
      ) : (
        <div className="nearby-list">
          {peerRows.map(({ key, item: peer, leaving }) => (
            <div className={`reveal${leaving ? ' is-leaving' : ''}`} key={key} aria-hidden={leaving || undefined}>
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

      {!controller.scanning && !serviceError && currentError && (
        <p className="nearby-warning">当前发现错误：{currentError}</p>
      )}
    </article>
  );
}
