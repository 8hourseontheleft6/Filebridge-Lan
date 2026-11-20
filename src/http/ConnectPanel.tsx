import { useConnectRequest } from '../features/connection/useConnectRequest';
import { InfoTip } from '../components/InfoTip';
import { Icon } from '../components/Icon';

interface ConnectPanelProps {
  onConnected: (token: string, expiresAt: number) => void;
  autoConnect?: boolean;
}

export function ConnectPanel({ onConnected, autoConnect = false }: ConnectPanelProps) {
  const controller = useConnectRequest(onConnected, autoConnect);
  const { phase, error, remaining, deviceName, waiting, failed } = controller;

  return (
    <div className={`connect-request-panel${waiting ? ' waiting' : ''}`}>
      <div className="connect-request-icon" aria-hidden><Icon name="arrow-up-right" size={16} /></div>
      <div className="connect-request-copy">
        <h3>
          {phase === 'waiting' ? '等待主机确认' : '请求主机允许连接'}
          <InfoTip text="主机端会显示这台设备的连接请求。允许后自动进入文件列表；拒绝或 60 秒未确认时不会获得访问授权。" />
        </h3>
        {phase === 'waiting' ? (
          <p>
            等待 <strong>{deviceName}</strong> 的请求
            <span className="connect-countdown">约 {remaining} 秒</span>
          </p>
        ) : (
          <p>发起后需要主机在 Filebridge 窗口中确认。</p>
        )}
        {error && <p className="connect-error">{error}</p>}
      </div>
      <button
        type="button"
        className="btn btn-primary btn-small connect-action"
        onClick={() => void controller.start()}
        disabled={waiting}
      >
        {phase === 'creating' ? '发送中…' : waiting ? '等待确认…' : failed ? '重新请求' : '请求主机允许'}
      </button>
    </div>
  );
}
