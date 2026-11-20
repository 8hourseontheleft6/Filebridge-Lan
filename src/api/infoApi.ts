/**
 * Hub info API (`/api/info`).
 */
import { http } from './httpClient';

export interface HubInfo {
  name: string;
  version: string;
  port: number;
  ips: string[];
  files: number;
}

const INFO_TIMEOUT_MS = 3000;

/** Throws ApiError on failure. */
export async function getHubInfo(options: { timeoutMs?: number; token?: string } = {}): Promise<HubInfo> {
  return http.get<HubInfo>('/api/info', {
    timeoutMs: options.timeoutMs ?? INFO_TIMEOUT_MS,
    token: options.token,
  });
}

/**
 * Best-effort info used by the UI probe: returns `null` instead of throwing,
 * matching the pre-refactor `fetchHubInfo` behaviour (3 s timeout).
 */
export async function getHubInfoOrNull(options: { timeoutMs?: number } = {}): Promise<HubInfo | null> {
  try {
    return await getHubInfo(options);
  } catch {
    return null;
  }
}
