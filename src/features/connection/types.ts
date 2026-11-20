/** Connection feature types (nearby discovery + connect requests). */
export type {
  ConnectRequestCreated,
  ConnectRequestStatus,
  ConnectStatus,
  PendingConnectRequest,
} from '../../api/connectionApi';

export type {
  DiscoveryPeer as NearbyPeer,
  DiscoveryStatus,
} from '../../platform/tauri';

/** Phases of an outgoing "request host approval" flow. */
export type ConnectPhase = 'idle' | 'creating' | 'waiting' | 'denied' | 'expired' | 'error';

/** Outcome of one status poll for a pending connect request. */
export interface ConnectOutcome {
  phase: ConnectPhase;
  token?: string;
  expiresAt?: number;
  error?: string;
  clearPending: boolean;
}
