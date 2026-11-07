export const PROBE_TIMEOUT_MS = 2000;
export const FAILURE_THRESHOLD = 2;
export const HEARTBEAT_STALE_MS = 10_000;

export interface ProbeOutcome {
  online: boolean | null;
  changed: boolean;
  offline: boolean;
}

export class ConnectionMonitor {
  private online: boolean | null = null;
  private failures = 0;
  private probing = false;

  get isOnline(): boolean | null {
    return this.online;
  }

  get failureCount(): number {
    return this.failures;
  }

  get isProbing(): boolean {
    return this.probing;
  }

  beginProbe(): boolean {
    if (this.probing) return false;
    this.probing = true;
    return true;
  }

  completeProbe(ok: boolean): ProbeOutcome {
    const previous = this.online;
    this.probing = false;
    if (ok) {
      this.failures = 0;
      this.online = true;
    } else {
      this.failures += 1;
      if (this.failures >= FAILURE_THRESHOLD) this.online = false;
    }
    return {
      online: this.online,
      changed: previous !== this.online,
      offline: this.online === false,
    };
  }

  noteHeartbeat(): void {
    this.failures = 0;
    this.online = true;
    this.probing = false;
  }

  heartbeatTimedOut(): ProbeOutcome {
    const previous = this.online;
    this.online = false;
    this.probing = false;
    this.failures = FAILURE_THRESHOLD;
    return { online: false, changed: previous !== false, offline: true };
  }

  reset(): void {
    this.online = null;
    this.failures = 0;
    this.probing = false;
  }
}

export function isHeartbeatStale(lastEventAt: number, now = Date.now(), threshold = HEARTBEAT_STALE_MS): boolean {
  return lastEventAt > 0 && now - lastEventAt > threshold;
}
