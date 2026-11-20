/**
 * Network gate service.
 *
 * Wraps the desktop network/LAN commands (through the network API port) and
 * owns the rules the gate UI relies on: signature comparison for re-showing the
 * warning, and the "only poll inside Tauri" decision.
 */
import { tauriNetworkApi, type NetworkApi } from '../../api/networkApi';
import type { LanServiceStatus, NetworkProfileStatus } from './types';

export const GATE_POLL_MS = 5000;

export interface GateSnapshot {
  status: NetworkProfileStatus;
  signature: string;
}

/** Stable identity for a gate state; a changed signature re-shows the warning. */
export function gateSignature(status: NetworkProfileStatus): string {
  return JSON.stringify([status.checked, status.compliant, status.error, status.networks]);
}

/** The desktop shell is the only runtime that can query Windows network profiles. */
export function shouldPollGate(desktop: boolean): boolean {
  return desktop;
}

export interface NetworkGateService {
  check(): Promise<GateSnapshot>;
  refreshLanService(): Promise<LanServiceStatus | null>;
  status(): Promise<LanServiceStatus>;
}

export function createNetworkGateService(api: NetworkApi = tauriNetworkApi): NetworkGateService {
  return {
    async check(): Promise<GateSnapshot> {
      try {
        const status = await api.getProfileStatus();
        return { status, signature: gateSignature(status) };
      } catch (reason) {
        const status: NetworkProfileStatus = {
          checked: false,
          compliant: false,
          networks: [],
          error: reason instanceof Error ? reason.message : String(reason),
        };
        return { status, signature: gateSignature(status) };
      }
    },
    async refreshLanService(): Promise<LanServiceStatus | null> {
      try {
        return await api.refreshLanService();
      } catch {
        return null;
      }
    },
    status() {
      return api.getLanServiceStatus();
    },
  };
}

/** True when the gate blocks LAN transfer for the current status. */
export function isGateBlocked(status: NetworkProfileStatus | null): boolean {
  return Boolean(status && !status.compliant);
}
