/**
 * Host approval controller: polls pending connect requests (2 s) on the host
 * machine and approves/denies them through the connection API.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { decideConnectRequest, listConnectRequests } from '../../api/connectionApi';
import { isHostCandidate } from './connectionService';
import type { PendingConnectRequest } from './types';

const HOST_POLL_MS = 2000;

export interface HostApprovalController {
  enabled: boolean;
  request: PendingConnectRequest | null;
  busy: boolean;
  decide(approve: boolean): Promise<void>;
}

export function useHostApproval(desktop: boolean, hostname: string): HostApprovalController {
  const enabled = isHostCandidate(desktop, hostname);
  const [requests, setRequests] = useState<PendingConnectRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      try {
        const items = await listConnectRequests();
        if (alive) setRequests(items);
      } catch {
        // Host page may not be ready yet; keep quiet until the Hub answers.
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, HOST_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [enabled]);

  const decide = useCallback(async (approve: boolean) => {
    const request = requests[0];
    if (!request || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await decideConnectRequest(request.id, approve);
      setRequests((items) => items.filter((item) => item.id !== request.id));
    } catch {
      // 410/409 happens when the dialog outlives the request; the next poll fixes it.
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [requests]);

  return { enabled, request: requests[0] ?? null, busy, decide };
}
