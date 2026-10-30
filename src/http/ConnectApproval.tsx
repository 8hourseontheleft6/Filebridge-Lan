import { useEffect, useState } from 'react';
import type { PendingConnectRequest } from './connect';

interface ConnectApprovalProps {
  request: PendingConnectRequest;
  busy: boolean;
  onDecision: (approve: boolean) => void;
}

function displayIp(value: string): string {
  return value.replace(/^::ffff:/i, '');
}

export function ConnectApproval({ request, busy, onDecision }: ConnectApprovalProps) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.ceil((request.expiresAt - Date.now()) / 1000))
  );

  useEffect(() => {
    setRemaining(Math.max(0, Math.ceil((request.expiresAt - Date.now()) / 1000)));
    const timer = window.setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((request.expiresAt - Date.now()) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [request.expiresAt]);

  return (
    <div className="approval-backdrop" role="presentation">
      <section
        className="approval-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
      >
        <div className="approval-mark" aria-hidden>↗</div>
        <p className="approval-eyebrow">连接请求</p>
        <h2 id="approval-title">允许设备访问吗？</h2>
        <p className="approval-device">{request.name}</p>
        <p className="approval-meta">
          来源 {displayIp(request.ip)} · {remaining > 0 ? `约 ${remaining} 秒后过期` : '即将过期'}
        </p>
        <p className="approval-hint">允许后，对方会获得 12 小时访问授权，可以查看、上传和下载文件。</p>
        <div className="approval-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onDecision(false)}
            disabled={busy}
          >
            拒绝
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onDecision(true)}
            disabled={busy}
          >
            {busy ? '处理中…' : '允许连接'}
          </button>
        </div>
      </section>
    </div>
  );
}
