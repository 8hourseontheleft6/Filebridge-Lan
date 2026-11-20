/**
 * Nearby computers controller: discovery peers + status polling (2 s) and the
 * refresh animation state. Only the desktop shell exposes discovery.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { createNearbyService } from './connectionService';
import { NEARBY_POLL_MS } from './connectionService';
import type { DiscoveryStatus, NearbyPeer } from './types';

export interface NearbyComputersController {
  peers: NearbyPeer[];
  discovery: DiscoveryStatus | null;
  scanning: boolean;
  error: string;
  refresh: () => Promise<void>;
  spinning: boolean;
  spinRefresh: () => void;
}

export function useNearbyComputers(desktop: boolean): NearbyComputersController {
  const serviceRef = useRef(createNearbyService());
  const [peers, setPeers] = useState<NearbyPeer[]>([]);
  const [discovery, setDiscovery] = useState<DiscoveryStatus | null>(null);
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState('');
  const [spinning, setSpinning] = useState(false);
  const spinTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (spinTimerRef.current !== null) window.clearTimeout(spinTimerRef.current);
  }, []);

  const refresh = useCallback(async () => {
    if (!desktop) return;
    const snapshot = await serviceRef.current.fetch();
    setPeers(snapshot.peers);
    setDiscovery(snapshot.discovery);
    setScanning(snapshot.scanning);
    setError(snapshot.error);
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, NEARBY_POLL_MS);
    return () => window.clearInterval(timer);
  }, [desktop, refresh]);

  const spinRefresh = useCallback(() => {
    if (spinTimerRef.current !== null) window.clearTimeout(spinTimerRef.current);
    setSpinning(false);
    window.requestAnimationFrame(() => setSpinning(true));
    spinTimerRef.current = window.setTimeout(() => {
      setSpinning(false);
      spinTimerRef.current = null;
    }, 620);
  }, []);

  return { peers, discovery, scanning, error, refresh, spinning, spinRefresh };
}
