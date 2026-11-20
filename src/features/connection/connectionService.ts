/**
 * Connection feature service.
 *
 * Two responsibilities, both testable without React:
 *  - nearby discovery state (peers / scanning / error) from the network API port;
 *  - the outgoing connect-request state machine (pending → approved/denied/expired)
 *    plus its sessionStorage hand-off, which stays on this device only.
 */
import type { ConnectRequestCreated, ConnectRequestStatus } from '../../api/connectionApi';
import type { NetworkApi } from '../../api/networkApi';
import { tauriNetworkApi } from '../../api/networkApi';
import type { ConnectOutcome, DiscoveryStatus, NearbyPeer } from './types';

export const NEARBY_POLL_MS = 2000;
export const CONNECT_STATUS_POLL_MS = 1200;
export const CONNECT_REQUEST_TTL_SECONDS = 60;

const PENDING_KEY = 'filebridge_connect_pending';

export interface NearbySnapshot {
  peers: NearbyPeer[];
  discovery: DiscoveryStatus | null;
  scanning: boolean;
  error: string;
}

/** Pure state mapping so the polling result is easy to test. */
export function nearbySnapshot(peers: NearbyPeer[] | null | undefined, status: DiscoveryStatus | null): NearbySnapshot {
  return {
    peers: Array.isArray(peers) ? peers : [],
    discovery: status,
    scanning: status?.status === 'starting',
    error: '',
  };
}

export function nearbyErrorSnapshot(reason: unknown): NearbySnapshot {
  return {
    peers: [],
    discovery: null,
    scanning: false,
    error: reason instanceof Error ? reason.message : String(reason),
  };
}

/** The host approval gate only runs on the desktop or on a loopback page. */
export function isHostCandidate(desktop: boolean, hostname: string): boolean {
  if (desktop) return true;
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
}

/** Display name shown to the host in the approval prompt. */
export function deviceDisplayName(userAgent: string | undefined = globalThis.navigator?.userAgent): string {
  const ua = userAgent || '';
  if (/Windows/i.test(ua)) return 'Windows 电脑';
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac 电脑';
  if (/Android/i.test(ua)) return 'Android 设备';
  if (/iPhone|iPad/i.test(ua)) return 'iPhone / iPad';
  if (/Linux/i.test(ua)) return 'Linux 电脑';
  return '另一台电脑';
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readPendingRequest(storage: KeyValueStorage, now = Date.now()): ConnectRequestCreated | null {
  try {
    const raw = storage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConnectRequestCreated>;
    if (
      typeof parsed.requestId !== 'string'
      || typeof parsed.requestSecret !== 'string'
      || typeof parsed.expiresAt !== 'number'
      || parsed.expiresAt <= now
    ) {
      storage.removeItem(PENDING_KEY);
      return null;
    }
    return parsed as ConnectRequestCreated;
  } catch {
    return null;
  }
}

export function savePendingRequest(storage: KeyValueStorage, request: ConnectRequestCreated): void {
  try {
    storage.setItem(PENDING_KEY, JSON.stringify(request));
  } catch {
    // sessionStorage unavailable only affects refresh recovery.
  }
}

export function clearPendingRequest(storage: KeyValueStorage): void {
  try {
    storage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}

export function remainingSeconds(expiresAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

/** Map one poll result to the next UI phase. */
export function connectOutcome(status: ConnectRequestStatus): ConnectOutcome {
  if (status.status === 'approved' && status.token) {
    return { phase: 'idle', token: status.token, expiresAt: status.expiresAt || 0, clearPending: true };
  }
  if (status.status === 'denied') {
    return { phase: 'denied', error: '主机拒绝了这次连接请求', clearPending: true };
  }
  if (status.status === 'expired') {
    return { phase: 'expired', error: '主机未确认或请求已过期', clearPending: true };
  }
  return { phase: 'waiting', clearPending: false };
}

/** Query failure message + whether the stored request should be dropped. */
export function connectStatusError(reason: unknown): { message: string; clearPending: boolean } {
  const message = reason instanceof Error ? reason.message : '查询连接状态失败';
  return { message, clearPending: message.includes('不存在') || message.includes('失效') };
}

export interface NearbyService {
  fetch(): Promise<NearbySnapshot>;
}

export function createNearbyService(api: NetworkApi = tauriNetworkApi): NearbyService {
  return {
    async fetch(): Promise<NearbySnapshot> {
      try {
        const [peers, status] = await Promise.all([api.listPeers(), api.getDiscoveryStatus()]);
        return nearbySnapshot(peers, status);
      } catch (reason) {
        return nearbyErrorSnapshot(reason);
      }
    },
  };
}

/** Scan state for the UI: waiting for the discovery service to start. */
export function nearbyServiceError(snapshot: NearbySnapshot): string {
  if (snapshot.discovery?.status === 'error') {
    return snapshot.discovery.currentError || snapshot.discovery.lastError || '发现服务启动失败';
  }
  return snapshot.error ? '发现服务不可用' : '';
}

export { PENDING_KEY };
