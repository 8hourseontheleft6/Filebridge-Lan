/**
 * Session / pairing API (`/api/session`, `/api/session/rotate`, `/api/pair`).
 *
 * Transport only: token persistence and session lifecycle live in the session
 * service/controller.
 */
import { ApiError } from './errors';
import { http } from './httpClient';

export interface PairedSession {
  token: string;
  expiresAt: number;
}

export interface RotatedSession {
  code: string;
}

/**
 * Desktop-only: ask the local Hub for the current pairing code.
 *
 * Mobile browsers and older Hubs answer 403/404; that is not an error for the
 * caller, so it maps to `null`.
 */
export async function readSessionCode(): Promise<string | null> {
  try {
    const data = await http.get<{ code?: string }>('/api/session', { timeoutMs: 3000 });
    return data?.code || null;
  } catch (error) {
    if (error instanceof ApiError && error.status !== null && error.status < 500) return null;
    return null;
  }
}

/** Exchange a pairing code for a bearer token. Auth errors keep their status. */
export async function pairSession(code: string): Promise<PairedSession> {
  return http.post<PairedSession>('/api/pair', { code }, { timeoutMs: 5000 });
}

/** Desktop-only: rotate the pairing code (Hub returns the new code). */
export async function rotateSession(): Promise<RotatedSession> {
  return http.post<RotatedSession>('/api/session/rotate', undefined, { timeoutMs: 5000 });
}
