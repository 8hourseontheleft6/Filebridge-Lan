/**
 * The single Tauri command boundary.
 *
 * Every `invoke` in the frontend goes through this module. Command names,
 * argument names and result shapes mirror `src-tauri/src/lib.rs` exactly; the
 * adapter adds no business rules.
 */
import { invoke } from '@tauri-apps/api/core';

export interface SavedFile {
  path: string;
  existed: boolean;
}

export interface DownloadDirState {
  dir: string;
}

export interface NetworkProfileEntry {
  name: string;
  category: string;
  label: string;
}

export interface NetworkProfileStatus {
  checked: boolean;
  compliant: boolean;
  networks: NetworkProfileEntry[];
  error?: string | null;
}

export interface LanServiceStatus {
  running: boolean;
  gate: string;
  detail: string | null;
  port: number;
}

export interface DiscoveryPeer {
  id: string;
  name: string;
  ip: string;
  port: number;
  version: string;
  url: string;
}

export interface DiscoveryStatus {
  status: string;
  bound: boolean;
  bindAddress?: string | null;
  sendTargets: string[];
  lastSendAt?: number | null;
  lastReceiveAt?: number | null;
  currentError?: string | null;
  lastError?: string | null;
  peerCount: number;
}

export const tauri = {
  // Downloads
  getDownloadDir: () => invoke<string>('get_download_dir'),
  defaultDownloadDir: () => invoke<string>('default_download_dir'),
  setDownloadDir: (path: string) => invoke<string>('set_download_dir', { path }),
  pickDownloadDir: (current?: string) =>
    invoke<string | null>('pick_download_dir', current ? { current } : {}),
  openDownloadDir: () => invoke<void>('open_download_dir'),
  saveDownload: (id: string, transferId?: string) =>
    invoke<SavedFile>('save_download', transferId ? { id, transferId } : { id }),
  cancelDownload: (transferId: string) => invoke<void>('cancel_download', { transferId }),
  openPath: (path: string) => invoke<void>('open_path', { path }),
  openExternal: (url: string) => invoke<void>('open_external', { url }),

  // Clipboard
  clipboardReadText: () => invoke<string | null>('clipboard_read_text'),
  clipboardWriteText: (text: string) => invoke<void>('clipboard_write_text', { text }),

  // Network / LAN gate
  networkProfileStatus: () => invoke<NetworkProfileStatus>('network_profile_status'),
  lanServiceRefresh: (): Promise<LanServiceStatus | null> =>
    invoke<LanServiceStatus | null>('lan_service_refresh'),
  lanServiceStatus: () => invoke<LanServiceStatus>('lan_service_status'),

  // Discovery / nearby computers
  discoveryPeers: () => invoke<DiscoveryPeer[]>('discovery_peers'),
  discoveryStatus: () => invoke<DiscoveryStatus>('discovery_status'),
};

export type TauriAdapter = typeof tauri;
