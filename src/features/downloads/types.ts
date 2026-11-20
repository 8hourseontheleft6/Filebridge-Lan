/** Download feature types (desktop save flow and browser download links). */
import type { SavedFile } from '../../platform/tauri';

export type DownloadStatus = 'copying' | 'cancelling';

export interface ActiveDownload {
  transferId: string;
  name: string;
  loaded: number;
  total: number;
  startedAt: number;
  status: DownloadStatus;
}

export interface DownloadToast {
  text: string;
  kind: 'success' | 'error' | 'info';
  path?: string;
}

/** Result of one desktop save, including the original cancellation copy. */
export type SaveOutcome =
  | { kind: 'saved'; result: SavedFile }
  | { kind: 'cancelled'; message: string }
  | { kind: 'error'; message: string };

export type { SavedFile };
