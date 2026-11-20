/**
 * Chunked resumable upload API (`/api/upload/chunk`).
 *
 * Only the offset/cancel JSON endpoints and URL builders live here; the actual
 * chunk bodies are streamed by the dedicated upload transport (XHR / fetch),
 * which must keep its current behaviour.
 */
import { API_BASE } from '../platform/runtime';
import { http } from './httpClient';
import type { HubFile } from './filesApi';

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
  const query = new URLSearchParams({
    name: target.name,
    id: target.uploadId,
    offset: String(target.offset),
    total: String(target.total),
  });
  return `${base}/api/upload/chunk?${query.toString()}`;
}
