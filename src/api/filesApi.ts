/**
 * File metadata API (`/api/files`, `/api/files/:id`).
 */
import { API_BASE } from '../platform/runtime';
import { http } from './httpClient';

export interface HubFile {
  id: string;
  name: string;
  size: number;
  sha256: string;
  mime: string;
  createdAt: number;
}

/** Token-authorized file list. Throws ApiError (401 = session gone). */
export async function listFiles(token: string, options: { timeoutMs?: number } = {}): Promise<HubFile[]> {
  const data = await http.get<HubFile[]>('/api/files', {
    token,
    timeoutMs: options.timeoutMs,
  });
  return Array.isArray(data) ? data : [];
}

export async function deleteFile(token: string, id: string): Promise<void> {
  await http.requestVoid(`/api/files/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    token,
  });
}

/**
 * Browser download URL. The Hub accepts the bearer token as `token` query for
 * downloads (native desktop downloads use the Tauri `save_download` command).
 */
export function fileDownloadUrl(id: string, token: string, base = API_BASE): string {
  return `${base}/api/files/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`;
}

/** SSE stream URL used by the transfer event transport. */
export function fileEventsUrl(token: string, base = API_BASE): string {
  return `${base}/api/events?token=${encodeURIComponent(token)}`;
}
