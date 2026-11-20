import { isTauriHost } from '../platform/runtime';
import { ConnectApproval } from './ConnectApproval';
import { useHostApproval } from '../features/connection/useHostApproval';

/**
 * 主机确认入口独立于“局域网直传 / 中继”页面，确保主机停留在中继页时
 * 仍能收到浏览器或另一台电脑发来的连接请求。
 */
export function HostApprovalGate() {
  const controller = useHostApproval(isTauriHost(), window.location.hostname);

  if (!controller.enabled || !controller.request) return null;

  return (
    <ConnectApproval
      request={controller.request}
      busy={controller.busy}
      onDecision={(approve) => { void controller.decide(approve); }}
    />
  );
}
