import { useEffect, useRef } from 'react';
import type { NetworkProfileStatus } from '../features/network/types';
import { Icon } from './Icon';

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
  // Nothing safe to bind: only virtual adapters, or no connected real network.
  const noUsableNetwork = status.checked && status.networks.length === 0;

  return (
    <div className="approval-backdrop" role="presentation">
      <section
        ref={cardRef}
        className="network-warning-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="network-warning-title"
      >
        <div className="network-warning-mark" aria-hidden><Icon name="alert" size={20} /></div>
        <h2 id="network-warning-title">
          {!status.checked
            ? '无法检测网络类型'
            : noUsableNetwork
              ? '没有可用的真实网络'
              : '当前网络类型需要调整'}
        </h2>
        <p className="network-warning-intro">
          {!status.checked
            ? '未能读取 Windows 网络类型。局域网服务不会启动，请确认网络已连接后重试。'
            : noUsableNetwork
              ? '只检测到虚拟网卡，或没有已连接的真实 Wi-Fi / 以太网。Filebridge 只会绑定真实网卡，因此局域网服务不会启动。'
              : 'Windows 将当前连接识别为公用网络。为避免在公用网络上暴露设备名和文件服务，Filebridge 的局域网服务不会启动。'}
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

        {noUsableNetwork ? (
          <p className="network-warning-tip">
            请连接真实的 Wi-Fi 或以太网。<br />
            虚拟网卡（VirtualBox / Hyper-V / VMware / TAP / VPN 等）不会承载局域网服务。
          </p>
        ) : (
          <p className="network-warning-tip">
            请把当前 Wi-Fi 或以太网改为“专用网络”：<br />
            Windows 设置 → 网络和 Internet → Wi-Fi / 以太网 → 当前网络 → 网络配置文件 → 专用网络
          </p>
        )}
        <p className="network-warning-tip">
          修复后可继续使用扫码、手动 IP 或配对码连接；应用会自动重新检测，无需重启。
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
