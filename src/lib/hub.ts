export const HUB_PORT = 42080;
export const SIGNAL_PORT = 42070;

export interface HubInfo {
  name: string;
  version: string;
  port: number;
  ips: string[];
  files: number;
}

/** Tauri 生产页面的 origin 是 http://tauri.localhost，不能用来拼 127.0.0.1 的 API 地址。 */
export function isTauriHost(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'tauri:'
    || window.location.hostname === 'tauri.localhost'
    || window.location.hostname === 'tauri.localhost.';
}

export function resolveApiBase(): string {
  if (typeof window === 'undefined') return `http://127.0.0.1:${HUB_PORT}`;
  if (isTauriHost()) return `http://127.0.0.1:${HUB_PORT}`;
  if (window.location.port === String(HUB_PORT)) return '';
  if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    return `${window.location.protocol}//${window.location.hostname}:${HUB_PORT}`;
  }
  return `http://127.0.0.1:${HUB_PORT}`;
}

export const API_BASE = resolveApiBase();

/** WebRTC 信令地址；Tauri 内嵌信令在本机 127.0.0.1，手机端用当前局域网 host。 */
export function resolveSignalUrl(): string {
  if (typeof window === 'undefined') return `ws://127.0.0.1:${SIGNAL_PORT}`;
  const host = isTauriHost() ? '127.0.0.1' : window.location.hostname;
  return `ws://${host}:${SIGNAL_PORT}`;
}

export const SIGNAL_URL = resolveSignalUrl();

function isLocalHost(host: string): boolean {
  return !host || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

function isIPv4(value: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(value);
}

/**
 * 生成手机访问地址。
 * 优先使用 Hub 返回的局域网 IPv4；没有 Hub 信息时退回当前页面的局域网 host。
 */
export function resolvePhoneBase(info?: HubInfo | null): string {
  const fromHub = (info?.ips || []).find((ip) => isIPv4(ip) && !ip.startsWith('127.'));
  const host = fromHub || (!isLocalHost(window.location.hostname) && isIPv4(window.location.hostname)
    ? window.location.hostname
    : '');
  if (!host) return '';

  // 开发时页面在 Vite(5173)，让手机也走 Vite，避免打开过期的 dist；
  // 生产/Tauri 或页面本身在 Hub(42080) 时使用 Hub 端口。
  const currentPort = window.location.port;
  const port = currentPort && currentPort !== String(HUB_PORT)
    ? currentPort
    : (info?.port || HUB_PORT);
  return `http://${host}:${port}`;
}

export async function fetchHubInfo(): Promise<HubInfo | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${API_BASE}/api/info`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as HubInfo;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}
