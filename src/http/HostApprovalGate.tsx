import { useCallback, useEffect, useState } from 'react';
import { API_BASE, isTauriHost } from '../lib/hub';
import { ConnectApproval } from './ConnectApproval';
import {
  decideConnectRequest,
  listConnectRequests,
  type PendingConnectRequest,
} from './connect';

function isHostCandidate(): boolean {
  if (isTauriHost()) return true;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

/**
 * 主机确认入口独立于“局域网直传 / 中继”页面，确保主机停留在中继页时
 * 仍能收到浏览器或另一台电脑发来的连接请求。
 */
export function HostApprovalGate() {
  const enabled = isHostCandidate();
  const [requests, setRequests] = useState<PendingConnectRequest[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      try {
        const items = await listConnectRequests(API_BASE);
        if (alive) setRequests(items);
      } catch {
        // 非主机页面或 Hub 尚未就绪时保持安静
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 2000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [enabled]);

  const decide = useCallback(async (approve: boolean) => {
    const request = requests[0];
    if (!request || busy) return;
    setBusy(true);
    try {
      await decideConnectRequest(request.id, approve);
      setRequests((items) => items.filter((item) => item.id !== request.id));
    } catch {
      // 410/409 常见于弹窗打开期间请求过期或被处理；下一轮刷新即可
    } finally {
      setBusy(false);
    }
  }, [busy, requests]);

  if (!enabled || requests.length === 0) return null;

  return (
    <ConnectApproval
      request={requests[0]}
      busy={busy}
      onDecision={(approve) => { void decide(approve); }}
    />
  );
}
