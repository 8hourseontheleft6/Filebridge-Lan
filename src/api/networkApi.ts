/**
 * Desktop platform API for network / LAN gate / discovery.
 *
 * Feature code calls these functions instead of importing the Tauri adapter,
 * so the platform boundary stays in one place and the behaviour is testable
 * with a fake adapter.
 */
import { tauri } from '../platform/tauri';
import type {
  DiscoveryPeer,
  DiscoveryStatus,
  LanServiceStatus,
  NetworkProfileStatus,
} from '../platform/tauri';

export type {
  DiscoveryPeer,
  DiscoveryStatus,
  LanServiceStatus,
  NetworkProfileStatus,
};

export interface NetworkApi {
  getProfileStatus(): Promise<NetworkProfileStatus>;
  refreshLanService(): Promise<LanServiceStatus | null>;
  getLanServiceStatus(): Promise<LanServiceStatus>;
  listPeers(): Promise<DiscoveryPeer[]>;
  getDiscoveryStatus(): Promise<DiscoveryStatus>;
}

export const tauriNetworkApi: NetworkApi = {
  getProfileStatus: () => tauri.networkProfileStatus(),
  refreshLanService: () => tauri.lanServiceRefresh(),
  getLanServiceStatus: () => tauri.lanServiceStatus(),
  listPeers: () => tauri.discoveryPeers(),
  getDiscoveryStatus: () => tauri.discoveryStatus(),
};

/** Default adapter used by the app (Tauri); tests can pass their own. */
export function createNetworkApi(api: NetworkApi = tauriNetworkApi): NetworkApi {
  return api;
}
