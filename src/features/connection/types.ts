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

/** Receive-only upload progress carried over the SSE stream. */
export interface LiveUpload {
  id: string;
  name: string;
  loaded: number;
  total: number;
  startedAt: number;
}

export interface UploadEventPayload {
  id: string;
  name: string;
  loaded: number;
  total: number;
  status: 'started' | 'progress' | 'completed' | 'failed';
}

/** Result of the files-list probe used for online/offline transitions. */
export type HubProbeKind = 'ok' | 'unauthorized' | 'error' | 'skipped';

export interface HubToast {
  text: string;
  kind: 'success' | 'error' | 'info';
  path?: string;
}
