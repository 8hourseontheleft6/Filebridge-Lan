/**
 * Downloads API glue.
 *
 * Native desktop saving is a Tauri command; browsers use the tokenized HTTP
 * URL. The actual save/open orchestration lives in the download service.
 */
import { tauri, type SavedFile } from '../platform/tauri';
import { fileDownloadUrl } from './filesApi';

export type { SavedFile };

/** Desktop: copy a Hub file into the user's download directory. */
export async function saveDownloadDesktop(id: string, transferId?: string): Promise<SavedFile> {
  return tauri.saveDownload(id, transferId);
}

/** Desktop: cancel an in-flight native save. */
export async function cancelDownloadDesktop(transferId: string): Promise<void> {
  return tauri.cancelDownload(transferId);
}

/** Browser fallback URL used by anchors / programmatic downloads. */
export function browserDownloadUrl(id: string, token: string): string {
  return fileDownloadUrl(id, token);
}
