/**
 * Clipboard sync API (`/api/clipboard`, `/api/clipboard/enabled`).
 *
 * The Hub derives `source` (desktop/phone) server-side; the client only sends
 * the text. Limits and rate limiting are enforced by the Hub.
 */
import { http } from './httpClient';

export interface ClipboardSnapshot {
  enabled: boolean;
  text: string | null;
  hash: string | null;
  updatedAt: number | null;
  revision: number;
  source: string | null;
  maxBytes: number;
}

/** Current clipboard snapshot for the approved session. */
export async function getClipboard(token: string): Promise<ClipboardSnapshot> {
  return http.get<ClipboardSnapshot>('/api/clipboard', { token });
}

/** Publish text to the current connection (source is server-derived). */
export async function setClipboardText(token: string, text: string): Promise<ClipboardSnapshot> {
  return http.post<ClipboardSnapshot>('/api/clipboard', { text }, { token });
}

export async function clearClipboard(token: string): Promise<ClipboardSnapshot> {
  return http.del<ClipboardSnapshot>('/api/clipboard', { token });
}

/** Host-only toggle (remote callers get 403 clipboard_host_only). */
export async function setClipboardEnabled(
  token: string,
  enabled: boolean,
): Promise<ClipboardSnapshot> {
  return http.post<ClipboardSnapshot>('/api/clipboard/enabled', { enabled }, { token });
}
