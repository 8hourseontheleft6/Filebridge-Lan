/**
 * Session / pairing service.
 *
 * Owns the pairing-code and token lifecycle: URL-hash precedence, sessionStorage
 * persistence, the desktop loopback session read, pairing, rotation and the
 * post-restart recovery. No React, no fetch, no Tauri: all I/O goes through the
 * injected session API port, so everything here is testable in Node.
 */
import { ApiError } from '../../api/errors';
import {
  pairSession as pairSessionApi,
  readSessionCode as readSessionCodeApi,
  rotateSession as rotateSessionApi,
} from '../../api/sessionApi';
import type {
  ConnectionTokenResult,
  InitialSessionResult,
  SessionApiPort,
  SessionRecoveryResult,
  SessionState,
  SessionStatus,
  SessionStorageAdapter,
} from './types';

export const SESSION_STORAGE_KEY = 'filebridge_session_code';
export const TOKEN_STORAGE_KEY = 'filebridge_session_token';

export const httpSessionApi: SessionApiPort = {
  readLocalSessionCode: () => readSessionCodeApi(),
  pair: (code) => pairSessionApi(code),
  rotate: () => rotateSessionApi(),
};

/** `#code=123456` wins over any persisted code. */
export function readCodeFromHash(hash: string): string {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  return (params.get('code') || '').trim();
}

/** sessionStorage can be unavailable (privacy mode / blocked storage). */
export function browserSessionStorage(): SessionStorageAdapter | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readPersistedSession(storage: SessionStorageAdapter | null): { code: string; token: string } {
  if (!storage) return { code: '', token: '' };
  try {
    return {
      code: (storage.getItem(SESSION_STORAGE_KEY) || '').trim(),
      token: (storage.getItem(TOKEN_STORAGE_KEY) || '').trim(),
    };
  } catch {
    return { code: '', token: '' };
  }
}

export function persistCode(storage: SessionStorageAdapter | null, code: string): void {
  if (!storage) return;
  try {
    storage.setItem(SESSION_STORAGE_KEY, code);
  } catch {
    // storage unavailable only affects refresh recovery
  }
}

export function persistToken(storage: SessionStorageAdapter | null, token: string): void {
  if (!storage || !token) return;
  try {
    storage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // storage unavailable only affects refresh recovery
  }
}

export function clearPersistedToken(storage: SessionStorageAdapter | null): void {
  if (!storage) return;
  try {
    storage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Pairing failures keep their original user-facing copy. */
export function pairErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return '配对码错误，请检查电脑上显示的 6 位配对码';
    if (error.status === 429) return '尝试次数过多，请稍后再试';
    if (error.status === 403) return '当前网络不允许配对，请确认电脑与手机在同一专用网络';
  }
  return '无法连接 Filebridge-Lan Hub，请确认电脑端服务在线';
}

/** Rotation failures keep their original user-facing copy. */
export function rotateErrorText(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) return '只有电脑本机可以重新生成配对码';
  return '重新生成失败，请确认 Hub 正常运行';
}

/** Exchange a pairing code; throws an Error carrying the mapped copy. */
export async function exchangePairingCode(
  code: string,
  api: SessionApiPort = httpSessionApi,
): Promise<ConnectionTokenResult> {
  try {
    return await api.pair(code);
  } catch (error) {
    throw new Error(pairErrorText(error));
  }
}

/** Rotate the host pairing code; throws an Error carrying the mapped copy. */
export async function rotatePairingCode(api: SessionApiPort = httpSessionApi): Promise<string> {
  try {
    const result = await api.rotate();
    return result.code;
  } catch (error) {
    throw new Error(rotateErrorText(error));
  }
}

export function normalizeCodeInput(value: string): string {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

export function sessionStatus(state: SessionState): SessionStatus {
  if (!state.sessionReady) return 'loading';
  return state.token ? 'paired' : 'needs_pairing';
}

export function initialSessionState(hash: string, storage: SessionStorageAdapter | null): SessionState {
  const persisted = readPersistedSession(storage);
  return {
    sessionCode: readCodeFromHash(hash) || persisted.code,
    token: persisted.token,
    sessionReady: false,
    codeError: '',
    codeInput: '',
    rotating: false,
  };
}

export function sessionAfterPair(state: SessionState, code: string, token: string): SessionState {
  return {
    ...state,
    sessionCode: code,
    token,
    sessionReady: true,
    codeError: '',
    codeInput: '',
    rotating: false,
  };
}

export function sessionAfterPairFailure(state: SessionState, code: string, message: string): SessionState {
  return {
    ...state,
    sessionCode: code,
    token: '',
    sessionReady: true,
    codeError: message,
    codeInput: code,
    rotating: false,
  };
}

export function sessionAfterExpired(state: SessionState, message: string): SessionState {
  return {
    ...state,
    token: '',
    sessionReady: true,
    codeError: message,
  };
}

export function sessionAfterConnected(state: SessionState, token: string): SessionState {
  return {
    ...state,
    token,
    sessionReady: true,
    codeError: '',
    rotating: false,
  };
}

export function sessionAfterRotate(state: SessionState, code: string, token: string): SessionState {
  return {
    ...state,
    sessionCode: code,
    token,
    sessionReady: true,
    codeError: '',
    codeInput: '',
    rotating: false,
  };
}

export interface LoadInitialSessionOptions {
  hash: string;
  storage: SessionStorageAdapter | null;
  api?: SessionApiPort;
  /** Only the local host may read `/api/session` (loopback). */
  localHubAccess: boolean;
}

/**
 * Initial load: hash/persisted code first, then the loopback session code
 * (desktop), then exchange the code for a token when one exists.
 */
export async function loadInitialSession({
  hash,
  storage,
  api = httpSessionApi,
  localHubAccess,
}: LoadInitialSessionOptions): Promise<InitialSessionResult> {
  let code = readCodeFromHash(hash) || readPersistedSession(storage).code;
  if (code) persistCode(storage, code);

  if (localHubAccess) {
    try {
      const local = await api.readLocalSessionCode();
      if (local) {
        code = local;
        persistCode(storage, local);
      }
    } catch {
      // Mobile browsers and older Hubs have no loopback session endpoint.
    }
  }

  if (!code) {
    const persisted = readPersistedSession(storage);
    return { sessionCode: '', token: persisted.token, codeError: '', codeInput: '' };
  }

  try {
    const paired = await exchangePairingCode(code, api);
    persistToken(storage, paired.token);
    return { sessionCode: code, token: paired.token, codeError: '', codeInput: '' };
  } catch (error) {
    clearPersistedToken(storage);
    return {
      sessionCode: code,
      token: '',
      codeError: error instanceof Error ? error.message : '配对失败',
      codeInput: code,
    };
  }
}

/**
 * Hub restart recovery: the in-memory token table is gone, but a local Hub's
 * session code is loopback-readable. Returns `null` when there is nothing to do.
 */
export async function recoverLocalSession({
  storage,
  api = httpSessionApi,
}: {
  storage: SessionStorageAdapter | null;
  api?: SessionApiPort;
}): Promise<SessionRecoveryResult | null> {
  const code = await api.readLocalSessionCode();
  if (!code) return null;
  const paired = await api.pair(code);
  persistCode(storage, code);
  persistToken(storage, paired.token);
  return { sessionCode: code, token: paired.token };
}

/** Pair from a manually entered code; throws mapped copy on failure. */
export async function unlockWithCode(
  code: string,
  api: SessionApiPort = httpSessionApi,
): Promise<ConnectionTokenResult> {
  return exchangePairingCode(code, api);
}

export const SESSION_KEYS = { code: SESSION_STORAGE_KEY, token: TOKEN_STORAGE_KEY } as const;
