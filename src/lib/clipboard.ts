/** Clipboard sync rules shared by the panel and the tests. */

/** Hard limit for one synced text, measured in UTF-8 bytes. */
export const CLIPBOARD_MAX_BYTES = 256 * 1024;

/** UTF-8 byte length, matching what the Hub counts. */
export function clipboardByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function isClipboardTextTooLarge(text: string): boolean {
  return clipboardByteLength(text) > CLIPBOARD_MAX_BYTES;
}

/**
 * A 401/403 means the session is no longer allowed to read text, so the panel
 * must drop whatever it was showing instead of keeping a stale secret.
 */
export function clipboardStatusDropsText(status: number): boolean {
  return status === 401 || status === 403;
}

/** User-facing message for a failed clipboard call. */
export function clipboardErrorText(status: number, code?: string | null): string {
  if (code === 'clipboard_too_large' || status === 413) return '文本超过 256 KiB 限制';
  if (code === 'clipboard_disabled' || status === 409) return '文字同步未开启';
  if (code === 'clipboard_rate_limited' || status === 429) return '文字同步过于频繁，请稍后再试';
  if (code === 'clipboard_host_only' || status === 403) return '只有电脑端可以切换文字同步';
  if (status === 401) return '连接已失效，请重新配对后再同步';
  if (code === 'clipboard_bad_request' || status === 400) return '文本格式不正确';
  return '文字同步失败，请稍后再试';
}

/** A cleared view keeps the enabled flag but forgets the text of the old session. */
export function clearClipboardText<T extends { text: string | null; hash: string | null; updatedAt: number | null; source: string | null }>(snapshot: T): T {
  return { ...snapshot, text: '', hash: null, updatedAt: null, source: null };
}

export interface PushDecision {
  /** UTF-8 byte length of the text read from the system clipboard. */
  bytes: number;
  /** Hash of the text read from the system clipboard. */
  hash: string;
  /** Hash of the text currently held by the Hub. */
  hubHash: string;
  /** Hash the desktop itself last pushed or wrote. */
  lastSystemHash: string;
}

/**
 * The desktop only pushes a new system-clipboard text when it differs from both
 * what the Hub already holds and what it last handled; otherwise the 2.5s poll
 * would echo forever.
 */
export function shouldPushSystemClipboard({ bytes, hash, hubHash, lastSystemHash }: PushDecision): boolean {
  if (bytes > CLIPBOARD_MAX_BYTES) return false;
  if (!hash) return false;
  return hash !== hubHash && hash !== lastSystemHash;
}

export interface WriteDecision {
  desktop: boolean;
  enabled: boolean;
  paused: boolean;
  text: string;
  hubHash: string | null;
  source: string | null;
  lastSystemHash: string;
}

/**
 * The desktop writes Hub text into the system clipboard only when the Hub text
 * came from another device; text the desktop itself pushed must not be written
 * back (that is the other half of the echo loop).
 */
export function shouldWriteSystemClipboard({
  desktop, enabled, paused, text, hubHash, source, lastSystemHash,
}: WriteDecision): boolean {
  if (!desktop || !enabled || paused) return false;
  if (!text || !hubHash) return false;
  if (source === 'desktop') return false;
  return hubHash !== lastSystemHash;
}
