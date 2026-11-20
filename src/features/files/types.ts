/** File list types (single source of truth for `HubFile`). */
export interface HubFile {
  id: string;
  name: string;
  size: number;
  sha256: string;
  mime: string;
  createdAt: number;
}

/** Per-request transport options; the connection probe keeps its own timeout. */
export interface FilesRequestOptions {
  timeoutMs?: number;
}

/** Transport surface used by the files service (backed by `src/api/filesApi.ts`). */
export interface FilesApiPort {
  listFiles(token: string, options?: FilesRequestOptions): Promise<HubFile[]>;
  deleteFile(token: string, id: string): Promise<void>;
}

/** Result of loading/refreshing the file list. */
export type FilesRefreshResult =
  | { kind: 'ok'; files: HubFile[] }
  | { kind: 'unauthorized' }
  | { kind: 'error'; message: string }
  | { kind: 'skipped' };

/** Result of deleting a single file. */
export type DeleteOneResult =
  | { kind: 'ok' }
  | { kind: 'unauthorized' }
  | { kind: 'error'; message: string };

/** Result of deleting the current selection. */
export type DeleteManyResult =
  | { kind: 'ok'; deleted: number; total: number }
  | { kind: 'unauthorized'; deleted: number; total: number }
  | { kind: 'error'; message: string; deleted: number; total: number };

/** Delete-selection outcome including the "nothing selected" early return. */
export type DeleteManyOutcome = DeleteManyResult | { kind: 'skipped' };

/** Selection/list state owned by the files controller. */
export interface FilesState {
  files: HubFile[];
  selectedIds: Set<string>;
  batchDeleting: boolean;
}
