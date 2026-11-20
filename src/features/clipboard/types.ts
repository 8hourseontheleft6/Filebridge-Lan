/**
 * Clipboard feature types.
 */
import type { ClipboardSnapshot } from '../../api/clipboardApi';

export type { ClipboardSnapshot };

/** Outcome of a user or polling action that may fail with a mapped message. */
export type ClipboardResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; dropsText: boolean };

/** Result of one system-clipboard poll (desktop -> Hub). */
export type SystemPullResult =
  | { kind: 'skipped' }
  | { kind: 'pushed'; snapshot: ClipboardSnapshot; systemHash: string }
  | { kind: 'failed'; message: string; dropsText: boolean };

/** Result of one Hub -> system-clipboard write. */
export type SystemWriteResult =
  | { kind: 'skipped' }
  | { kind: 'written'; systemHash: string }
  | { kind: 'failed'; message: string };
