/**
 * The single Tauri event boundary (desktop events such as download progress).
 *
 * Components and hooks subscribe through this module; no other file imports
 * `@tauri-apps/api/event`.
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type { UnlistenFn };

export interface DownloadProgressPayload {
  transferId: string;
  loaded: number;
  total: number;
  status: 'copying' | 'completed' | 'cancelled' | 'failed';
}

export interface TauriEventMap {
  'download-progress': DownloadProgressPayload;
}

export function listenTauriEvent<K extends keyof TauriEventMap>(
  name: K,
  handler: (payload: TauriEventMap[K]) => void,
): Promise<UnlistenFn> {
  return listen<TauriEventMap[K]>(name, (event) => handler(event.payload));
}
