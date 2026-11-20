/** Session / pairing types. */

/** Minimal storage surface so the service can be tested without a browser. */
export interface SessionStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Lifecycle derived from the controller state. */
export type SessionStatus = 'loading' | 'needs_pairing' | 'paired';

/** Everything the transfer UI needs to render session state. */
export interface SessionState {
  sessionCode: string;
  token: string;
  sessionReady: boolean;
  codeError: string;
  codeInput: string;
  rotating: boolean;
}

/** Token returned by a successful pairing. */
export interface ConnectionTokenResult {
  token: string;
  expiresAt: number;
}

/** Result of the automatic loopback recovery after the Hub restarted. */
export interface SessionRecoveryResult {
  sessionCode: string;
  token: string;
}

/** HTTP surface used by the session service (backed by `src/api/sessionApi.ts`). */
export interface SessionApiPort {
  readLocalSessionCode(): Promise<string | null>;
  pair(code: string): Promise<ConnectionTokenResult>;
  rotate(): Promise<{ code: string }>;
}

/** Result of the initial session load. */
export interface InitialSessionResult {
  sessionCode: string;
  token: string;
  codeError: string;
  codeInput: string;
}
