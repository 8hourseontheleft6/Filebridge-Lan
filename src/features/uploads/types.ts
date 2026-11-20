/**
 * Upload feature types.
 *
 * `UploadState` is the single state shape the controller owns and the page
 * renders; the service only emits patches for it.
 */
import type { HubFile } from '../files/types';
import type {
  ChunkUploadResponse,
  ServerChunkDiag,
  UploadPhase,
  UploadTransport,
} from '../../api/uploadApi';

export type { ChunkUploadResponse, UploadPhase, UploadTransport };

export type UploadStatus = 'uploading' | 'retrying' | 'done' | 'error' | 'cancelled';

export interface UploadState {
  name: string;
  loaded: number;
  total: number;
  startedAt: number;
  status: UploadStatus;
  error?: string;
  file?: File;
  uploadId?: string;
  offset?: number;
  confirmedOffset?: number;
  inFlightLoaded?: number;
  checking?: boolean;
  serverDiag?: ServerChunkDiag | null;
  transport?: string;
  requestPhase?: string;
  batchIndex?: number;
  batchCount?: number;
  batchTotal?: number;
  batchBase?: number;
  batchStartedAt?: number;
}

export interface UploadBatch {
  index: number;
  count: number;
  totalBytes: number;
  baseBytes: number;
  startedAt: number;
}

export interface UploadQueue {
  files: File[];
  index: number;
  completedBytes: number;
  totalBytes: number;
  startedAt: number;
}

/** Server-confirmed upload progress. */
export interface UploadServerStatus {
  offset: number;
  complete: boolean;
  file?: HubFile;
  diagnostics: ServerChunkDiag | null;
}

/** A state patch, or an updater so the service can preserve `prev` fields. */
export type UploadUpdate =
  | Partial<UploadState>
  | ((previous: UploadState) => Partial<UploadState>);

export interface ChunkSendCallbacks {
  onProgress: (inFlightLoaded: number) => void;
  onPhase: (phase: UploadPhase) => void;
}

/** Transport port: one chunk POST, with progress/phase callbacks. */
export interface ChunkSender {
  (
    file: File,
    uploadId: string,
    offset: number,
    chunkSize: number,
    transport: UploadTransport,
    callbacks: ChunkSendCallbacks,
  ): Promise<ChunkUploadResponse>;
}
