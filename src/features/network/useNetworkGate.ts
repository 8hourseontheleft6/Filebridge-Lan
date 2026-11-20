/**
 * Network gate controller.
 *
 * Polls the desktop network profile + LAN service state every 5 s (inside Tauri
 * only), re-shows the warning when the gate state changes, and exposes a
 * dismiss action that is local UI state only — it never bypasses the Hub gate.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { NetworkApi } from '../../api/networkApi';
import { GATE_POLL_MS, createNetworkGateService, shouldPollGate } from './networkService';
import type { LanServiceStatus, NetworkProfileStatus } from './types';

export interface NetworkGateOptions {
  desktop: boolean;
  api?: NetworkApi;
  pollMs?: number;
}

export interface NetworkGate {
  networkStatus: NetworkProfileStatus | null;
  lanServiceStatus: LanServiceStatus | null;
  networkChecking: boolean;
  dismissed: boolean;
  dismiss(): void;
  refresh(): Promise<void>;
}

export function useNetworkGate({
  desktop,
  api,
  pollMs = GATE_POLL_MS,
}: NetworkGateOptions): NetworkGate {
  const serviceRef = useRef(createNetworkGateService(api));
  const [networkStatus, setNetworkStatus] = useState<NetworkProfileStatus | null>(null);
  const [lanServiceStatus, setLanServiceStatus] = useState<LanServiceStatus | null>(null);
  const [networkChecking, setNetworkChecking] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const signatureRef = useRef('');

  const refresh = useCallback(async () => {
    if (!shouldPollGate(desktop)) return;
    setNetworkChecking(true);
    try {
      const snapshot = await serviceRef.current.check();
      if (signatureRef.current !== snapshot.signature) {
        signatureRef.current = snapshot.signature;
        setDismissed(false);
      }
      setNetworkStatus(snapshot.status);
      const service = await serviceRef.current.refreshLanService();
      setLanServiceStatus(service);
    } finally {
      setNetworkChecking(false);
    }
  }, [desktop]);

  useEffect(() => {
    if (!shouldPollGate(desktop)) return;
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, pollMs);
    return () => window.clearInterval(timer);
  }, [desktop, pollMs, refresh]);

  const dismiss = useCallback(() => setDismissed(true), []);

  return {
    networkStatus,
    lanServiceStatus,
    networkChecking,
    dismissed,
    dismiss,
    refresh,
  };
}
