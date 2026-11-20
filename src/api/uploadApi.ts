/**
 * Chunked resumable upload API (`/api/upload/chunk`).
 *
 * Offset/cancel JSON endpoints and the two chunk transports (XHR for broad
 * compatibility, fetch+Blob for iOS Safari). Transport code maps raw HTTP to
 * `ChunkUploadError`; the upload service decides what each failure means for
 * retry/resume and what the user sees.
 */
import { API_BASE } from '../platform/runtime';
import { http } from './httpClient';
import type { HubFile } from './filesApi';

export const UPLOAD_CHUNK_TIMEOUT_MS = 90_000;

export interface ServerChunkDiag {
  bodyRead?: number | null;
  partSize?: number | null;
  bodyState?: string | null;
  lastError?: string | null;
  contentLength?: number | null;
  transferEncoding?: string | null;
  expect?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
}

export interface UploadOffsetState {
  offset: number;
  complete: boolean;
  file?: HubFile;
  diagnostics: ServerChunkDiag | null;
}

/** Server-confirmed offset for a resumable upload. */
export async function getUploadOffset(token: string, uploadId: string): Promise<UploadOffsetState> {
  const data = await http.get<{
    offset?: number;
    complete?: boolean;
    file?: HubFile;
    diagnostics?: ServerChunkDiag | null;
  }>(`/api/upload/chunk/${encodeURIComponent(uploadId)}`, { token });
  return {
    offset: Number(data?.offset || 0),
    complete: Boolean(data?.complete),
    file: data?.file,
    diagnostics: data?.diagnostics ?? null,
  };
}

/** Cancel an in-flight resumable upload (best effort). */
export async function cancelUpload(token: string, uploadId: string): Promise<void> {
  await http.requestVoid(`/api/upload/chunk/${encodeURIComponent(uploadId)}`, {
    method: 'DELETE',
    token,
    timeoutMs: 5000,
  });
}

export interface ChunkUploadTarget {
  name: string;
  uploadId: string;
  offset: number;
  total: number;
}

/** POST target for one chunk; the transport streams the file slice itself. */
export function chunkUploadUrl(target: ChunkUploadTarget, base = API_BASE): string {
  // Keep the pre-refactor query encoding (`%20` for spaces, this exact order).
  return `${base}/api/upload/chunk?name=${encodeURIComponent(target.name)}&id=${encodeURIComponent(target.uploadId)}&offset=${target.offset}&total=${target.total}`;
}

export type UploadTransport = 'xhr-blob' | 'fetch-blob';

export type UploadPhase =
  | 'created'
  | 'uploading'
  | 'upload-complete'
  | 'response-received';

export interface ChunkUploadResponse {
  offset: number;
  complete: boolean;
  file?: HubFile;
}

export type ChunkUploadErrorKind =
  | 'http'
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'invalid-json';

export interface ChunkUploadErrorOptions {
  kind: ChunkUploadErrorKind;
  message: string;
  status?: number | null;
  offset?: number | null;
  serverMessage?: string | null;
}

/** Transport failure carrying protocol facts; the service maps user copy. */
export class ChunkUploadError extends Error {
  readonly kind: ChunkUploadErrorKind;
  readonly status: number | null;
  /** Parsed `offset` from a 409 body; null when the body was not parseable. */
  readonly offset: number | null;
  readonly serverMessage: string | null;

  constructor(options: ChunkUploadErrorOptions) {
    super(options.message);
    this.name = 'ChunkUploadError';
    this.kind = options.kind;
    this.status = options.status ?? null;
    this.offset = options.offset ?? null;
    this.serverMessage = options.serverMessage ?? null;
  }
}

export interface ChunkUploadRequest {
  token: string;
  file: File;
  uploadId: string;
  offset: number;
  chunkSize: number;
  signal?: AbortSignal;
  onProgress?: (inFlightLoaded: number) => void;
  onPhase?: (phase: UploadPhase) => void;
}

function abortError(): ChunkUploadError {
  return new ChunkUploadError({ kind: 'aborted', message: '请求已取消' });
}

/** XHR chunk transport (Broad browser compatibility path). */
export function uploadChunkXhr(request: ChunkUploadRequest): Promise<ChunkUploadResponse> {
  if (!request.token) {
    return Promise.reject(
      new ChunkUploadError({ kind: 'http', message: '缺少访问授权' }),
    );
  }
  if (request.signal?.aborted) return Promise.reject(abortError());

  return new Promise<ChunkUploadResponse>((resolve, reject) => {
    const target: ChunkUploadTarget = {
      name: request.file.name,
      uploadId: request.uploadId,
      offset: request.offset,
      total: request.file.size,
    };
    const end = Math.min(request.offset + request.chunkSize, request.file.size);
    const chunk = request.file.slice(request.offset, end);
    const xhr = new XMLHttpRequest();
    let settled = false;

    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      request.signal?.removeEventListener('abort', abort);
      settle();
    };
    const abort = () => xhr.abort();

    request.onPhase?.('created');
    xhr.open('POST', chunkUploadUrl(target));
    xhr.setRequestHeader('Content-Type', request.file.type || 'application/octet-stream');
    xhr.setRequestHeader('Authorization', `Bearer ${request.token}`);
    xhr.timeout = UPLOAD_CHUNK_TIMEOUT_MS;

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      request.onProgress?.(Math.min(request.file.size, request.offset + event.loaded));
    };
    xhr.upload.onload = () => request.onPhase?.('upload-complete');

    xhr.onload = () => {
      request.onPhase?.('response-received');
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = JSON.parse(xhr.responseText) as ChunkUploadResponse;
          finish(() => resolve(parsed));
        } catch {
          finish(() =>
            reject(
              new ChunkUploadError({
                kind: 'invalid-json',
                message: '服务器返回了无效 JSON',
                status: xhr.status,
              }),
            ),
          );
        }
        return;
      }

      let parsed: { error?: unknown; offset?: unknown } | null = null;
      try {
        parsed = JSON.parse(xhr.responseText) as { error?: unknown; offset?: unknown };
      } catch {
        parsed = null;
      }
      const serverMessage = typeof parsed?.error === 'string' ? parsed.error : null;

      if (xhr.status === 409) {
        // A parseable body always carries an offset (missing -> 0), matching
        // the old inline transport; only invalid JSON falls back to a retry.
        const offset = parsed ? Number(parsed.offset || 0) : null;
        finish(() =>
          reject(
            new ChunkUploadError({
              kind: 'http',
              status: 409,
              offset,
              serverMessage,
              message: serverMessage || '上传中断，可继续上传',
            }),
          ),
        );
        return;
      }

      finish(() =>
        reject(
          new ChunkUploadError({
            kind: 'http',
            status: xhr.status,
            serverMessage,
            message:
              serverMessage ||
              (xhr.status === 413 ? '文件超过 Hub 限制' : '上传中断，可继续上传'),
          }),
        ),
      );
    };

    xhr.onerror = () =>
      finish(() =>
        reject(
          new ChunkUploadError({
            kind: 'network',
            message: '网络中断，进度已保留，可继续上传',
          }),
        ),
      );
    xhr.ontimeout = () =>
      finish(() =>
        reject(
          new ChunkUploadError({
            kind: 'timeout',
            message: '上传分块超时，进度已保留，可继续上传',
          }),
        ),
      );
    xhr.onabort = () => finish(() => reject(abortError()));

    request.signal?.addEventListener('abort', abort, { once: true });
    xhr.send(chunk);
  });
}

/** iOS Safari chunk transport: fetch + Blob, then reconcile through the status GET. */
export async function uploadChunkFetch(
  request: ChunkUploadRequest,
): Promise<ChunkUploadResponse> {
  if (request.signal?.aborted) throw abortError();

  const target: ChunkUploadTarget = {
    name: request.file.name,
    uploadId: request.uploadId,
    offset: request.offset,
    total: request.file.size,
  };
  const end = Math.min(request.offset + request.chunkSize, request.file.size);
  const chunk = request.file.slice(request.offset, end);
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  request.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, UPLOAD_CHUNK_TIMEOUT_MS);

  try {
    request.onPhase?.('uploading');
    let response: Response;
    try {
      response = await fetch(chunkUploadUrl(target), {
        method: 'POST',
        headers: {
          'Content-Type': request.file.type || 'application/octet-stream',
          Authorization: `Bearer ${request.token}`,
        },
        body: chunk,
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (reason) {
      const message =
        reason instanceof Error && reason.message ? reason.message : '上传中断，可继续上传';
      if (request.signal?.aborted) {
        throw new ChunkUploadError({ kind: 'aborted', message });
      }
      if (timedOut) throw new ChunkUploadError({ kind: 'timeout', message });
      throw new ChunkUploadError({ kind: 'network', message });
    }

    request.onPhase?.('response-received');
    // iOS WebKit can deliver the response headers but stall while reading the
    // response body. Do not depend on the body; reconcile through the status GET.
    await response.body?.cancel().catch(() => {});
    if (response.status === 409) {
      // The service resolves the authoritative offset before retrying.
      throw new ChunkUploadError({
        kind: 'http',
        status: 409,
        offset: null,
        message: '上传中断，可继续上传',
      });
    }
    if (!response.ok) {
      throw new ChunkUploadError({
        kind: 'http',
        status: response.status,
        message:
          response.status === 413 ? '文件超过 Hub 限制' : '上传中断，可继续上传',
      });
    }

    const status = await getUploadOffset(request.token, request.uploadId);
    return { offset: status.offset, complete: status.complete, file: status.file };
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', onAbort);
  }
}
