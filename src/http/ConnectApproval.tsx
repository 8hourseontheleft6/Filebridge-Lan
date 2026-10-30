import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
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
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const buttons = cardRef.current?.querySelectorAll<HTMLButtonElement>('button');
    buttons?.[0]?.focus();
  }, []);

  useEffect(() => {
    setRemaining(Math.max(0, Math.ceil((request.expiresAt - Date.now()) / 1000)));
    const timer = window.setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((request.expiresAt - Date.now()) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [request.expiresAt]);

  function trapFocus(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') return;
    const buttons = [...(cardRef.current?.querySelectorAll<HTMLButtonElement>('button') || [])]
      .filter((button) => !button.disabled);
    if (buttons.length === 0) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="approval-backdrop" role="presentation">
      <section
        ref={cardRef}
        className="approval-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        onKeyDown={trapFocus}
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
