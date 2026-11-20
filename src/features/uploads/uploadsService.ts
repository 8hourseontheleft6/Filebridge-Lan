/**
 * Chunked upload application service.
 *
 * Owns the retry loop, server-offset reconciliation and cancellation rules.
 * It never touches React or the DOM transport directly: chunk sends and
 * offset queries come in as ports, and state leaves as patches.
 */
import { ChunkUploadError } from '../../api/uploadApi';
import { makeTransferId } from '../../lib/transferId';
import type { HubFile } from '../files/types';
import type {
  ChunkSendCallbacks,
  ChunkSender,
  UploadBatch,
  UploadQueue,
  UploadServerStatus,
  UploadState,
  UploadTransport,
  UploadUpdate,
} from './types';

export const UPLOAD_CHUNK_SIZE = 4 * 1024 * 1024;
export const IOS_UPLOAD_CHUNK_SIZE = 2 * 1024 * 1024;
const UPLOAD_MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 700;

export { makeTransferId };

export class UploadOffsetError extends Error {
  offset: number;

  constructor(offset: number) {
    super(`服务器已有 ${offset} 字节`);
    this.name = 'UploadOffsetError';
    this.offset = offset;
  }
}

export class UploadCancelledError extends Error {
  constructor() {
    super('已取消');
    this.name = 'UploadCancelledError';
  }
}

export interface UploadFilePorts {
  transport: UploadTransport;
  chunkSize: number;
  sendChunk: ChunkSender;
  queryOffset: (uploadId: string) => Promise<UploadServerStatus>;
  isCancelled: () => boolean;
  /** XHR 401: the session must expire, exactly like the old inline transport. */
  onUnauthorized: () => void;
  onUpdate: (update: UploadUpdate) => void;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Initial state for one upload run (also used for batch members). */
export function createUploadState(
  file: File,
  uploadId: string,
  initialOffset: number,
  batch?: UploadBatch,
): UploadState {
  return {
    name: file.name,
    loaded: initialOffset,
    total: file.size,
    startedAt: batch?.startedAt || Date.now(),
    status: 'uploading',
    file,
    uploadId,
    offset: initialOffset,
    confirmedOffset: initialOffset,
    inFlightLoaded: initialOffset,
    checking: false,
    serverDiag: null,
    batchIndex: batch?.index,
    batchCount: batch?.count,
    batchTotal: batch?.totalBytes,
    batchBase: batch?.baseBytes ?? 0,
    batchStartedAt: batch?.startedAt,
  };
}

function phaseCallbacks(
  ports: UploadFilePorts,
  offset: number,
  chunkSize: number,
  fileSize: number,
): ChunkSendCallbacks {
  const end = Math.min(offset + chunkSize, fileSize);
  return {
    onProgress: (inFlightLoaded) => {
      ports.onUpdate({
        loaded: inFlightLoaded,
        inFlightLoaded,
        total: fileSize,
      });
    },
    onPhase: (phase) => {
      if (phase === 'response-received') {
        ports.onUpdate((prev) => ({
          requestPhase: phase,
          loaded: Math.max(prev.loaded, end),
          inFlightLoaded: Math.max(prev.inFlightLoaded || 0, end),
        }));
        return;
      }
      ports.onUpdate({ requestPhase: phase });
    },
  };
}

/**
 * Upload one file from `initialOffset`, reconciling with the server after any
 * failed chunk. Returns the saved HubFile; throws UploadCancelledError on
 * cancellation and the last transport error after the retry budget is spent.
 */
export async function uploadFile(
  file: File,
  uploadId: string,
  initialOffset: number,
  batch: UploadBatch | undefined,
  ports: UploadFilePorts,
): Promise<HubFile> {
  const { transport, chunkSize } = ports;
  const sleep = ports.sleep ?? defaultSleep;
  let confirmedOffset = initialOffset;
  let offset = initialOffset;

  while (offset <= file.size) {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < UPLOAD_MAX_ATTEMPTS; attempt += 1) {
      if (ports.isCancelled()) throw new UploadCancelledError();

      try {
        const result = await ports.sendChunk(
          file,
          uploadId,
          offset,
          chunkSize,
          transport,
          phaseCallbacks(ports, offset, chunkSize, file.size),
        );

        if (result.complete && result.file) {
          ports.onUpdate({
            loaded: result.offset,
            inFlightLoaded: result.offset,
            confirmedOffset: result.offset,
            offset: result.offset,
            status: 'uploading',
          });
          return result.file;
        }

        confirmedOffset = result.offset;
        offset = result.offset;
        ports.onUpdate({
          offset,
          confirmedOffset,
          loaded: confirmedOffset,
          inFlightLoaded: confirmedOffset,
          status: 'uploading',
          checking: false,
        });
        lastError = null;
        break;
      } catch (reason) {
        if (reason instanceof UploadCancelledError) throw reason;

        // XHR cancellation is terminal immediately; fetch cancellation is
        // reconciled first and turned into UploadCancelledError by the flag
        // check on the next attempt (matching the old inline loop).
        if (
          transport === 'xhr-blob' &&
          reason instanceof ChunkUploadError &&
          reason.kind === 'aborted'
        ) {
          throw new UploadCancelledError();
        }

        let failure: unknown = reason;
        if (reason instanceof ChunkUploadError) {
          if (reason.status === 401 && transport === 'xhr-blob') {
            ports.onUnauthorized();
          }
          if (reason.status === 409) {
            if (transport === 'fetch-blob') {
              // fetch transport did not read the 409 body; ask the status GET.
              try {
                const status = await ports.queryOffset(uploadId);
                failure = new UploadOffsetError(status.offset);
              } catch (queryError) {
                failure = queryError;
              }
            } else if (reason.offset !== null) {
              failure = new UploadOffsetError(reason.offset);
            }
          }
        }
        lastError = failure instanceof Error ? failure : new Error(String(failure));

        // Always reconcile with the server after a failed chunk. The browser's
        // upload progress is only "sent", never "saved".
        let serverStatus: UploadServerStatus | null = null;
        try {
          serverStatus = await ports.queryOffset(uploadId);
        } catch {
          // Keep the last confirmed offset; never promote in-flight bytes.
        }

        if (serverStatus?.complete && serverStatus.file) {
          const doneFile = serverStatus.file;
          const doneOffset = serverStatus.offset;
          ports.onUpdate({
            loaded: doneOffset,
            inFlightLoaded: doneOffset,
            confirmedOffset: doneOffset,
            offset: doneOffset,
            status: 'uploading',
          });
          return doneFile;
        }

        if (serverStatus) {
          const status = serverStatus;
          confirmedOffset = status.offset;
          offset = status.offset;
          ports.onUpdate((prev) => ({
            confirmedOffset,
            offset,
            serverDiag: status.diagnostics ?? prev.serverDiag,
            status: 'retrying',
            checking: false,
          }));
        } else if (failure instanceof UploadOffsetError) {
          confirmedOffset = failure.offset;
          offset = failure.offset;
          ports.onUpdate({
            confirmedOffset,
            offset,
            status: 'retrying',
            checking: false,
          });
        } else {
          ports.onUpdate({ status: 'retrying', checking: false });
        }

        if (attempt < UPLOAD_MAX_ATTEMPTS - 1) {
          await sleep(RETRY_BASE_MS * (attempt + 1));
        }
      }
    }

    if (lastError) {
      if (ports.isCancelled()) throw new UploadCancelledError();
      const message = lastError.message;
      ports.onUpdate({
        status: 'error',
        offset,
        confirmedOffset,
        checking: false,
        error: message,
      });
      throw lastError;
    }

    if (offset >= file.size) {
      try {
        const status = await ports.queryOffset(uploadId);
        if (status.complete && status.file) {
          ports.onUpdate({
            loaded: status.offset,
            inFlightLoaded: status.offset,
            confirmedOffset: status.offset,
            offset: status.offset,
          });
          return status.file;
        }
      } catch {
        // fall through to a normal retry
      }

      if (offset === file.size) {
        // Retry the final zero-length chunk so a lost completion response can finalize.
        const result = await ports.sendChunk(
          file,
          uploadId,
          offset,
          chunkSize,
          transport,
          phaseCallbacks(ports, offset, chunkSize, file.size),
        );
        if (result.complete && result.file) return result.file;
      }
    }
  }

  throw new Error('上传未完成');
}

export function createUploadQueue(
  files: File[],
  startIndex: number,
  completedBefore: number,
  startedAt: number,
): UploadQueue {
  return {
    files,
    index: startIndex,
    completedBytes: completedBefore,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    startedAt,
  };
}

export function advanceUploadQueue(
  queue: UploadQueue,
  index: number,
  completedBytes: number,
): UploadQueue {
  return { ...queue, index, completedBytes };
}
