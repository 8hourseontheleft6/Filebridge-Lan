import { useEffect, useRef } from 'react';
import type { NetworkProfileStatus } from '../App';

interface NetworkWarningProps {
  status: NetworkProfileStatus;
  retrying: boolean;
  onRetry: () => void;
  onClose: () => void;
}

export function NetworkWarning({ status, retrying, onRetry, onClose }: NetworkWarningProps) {
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    cardRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);

  const publicNetworks = status.networks.filter(
    (network) => network.category !== 'private' && network.category !== 'domain'
  );

  return (
    <div className="approval-backdrop" role="presentation">
      <section
        ref={cardRef}
        className="network-warning-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="network-warning-title"
      >
        <div className="network-warning-mark" aria-hidden>!</div>
        <p className="approval-eyebrow">网络检测</p>
        <h2 id="network-warning-title">
          {status.checked ? '当前网络类型需要调整' : '无法检测网络类型'}
        </h2>
        <p className="network-warning-intro">
          {status.checked
            ? 'Windows 将当前连接识别为公用网络。公用网络会阻止 Filebridge-Lan 的局域网发现和文件访问。'
            : '未能读取 Windows 网络类型。请确认网络已连接后重试。'}
        </p>

        {publicNetworks.length > 0 && (
          <div className="network-warning-list">
            {publicNetworks.map((network) => (
              <div className="network-warning-item" key={`${network.name}-${network.category}`}>
                <strong>{network.name}</strong>
                <span>{network.label}</span>
              </div>
            ))}
          </div>
        )}

        {status.error && <p className="network-warning-error">{status.error}</p>}

        <p className="network-warning-tip">
          请把当前 Wi-Fi 或以太网改为“专用网络”：<br />
          Windows 设置 → 网络和 Internet → Wi-Fi / 以太网 → 当前网络 → 网络配置文件 → 专用网络
        </p>

        <div className="network-warning-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={retrying}>
            稍后设置
          </button>
          <button type="button" className="btn btn-primary" onClick={onRetry} disabled={retrying}>
            {retrying ? '检测中…' : '重新检测'}
          </button>
        </div>
      </section>
    </div>
  );
}
