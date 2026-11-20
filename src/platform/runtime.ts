/**
 * Runtime environment boundary.
 *
 * This is the only frontend module allowed to decide *where* the Hub lives and
 * whether the app runs inside the Tauri desktop shell. Feature code must never
 * guess ports or host names by itself.
 */
export const HUB_PORT = 42080;

/** True when the page is served by the Tauri desktop shell. */
export function isTauriHost(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.location.protocol === 'tauri:' ||
    window.location.hostname === 'tauri.localhost' ||
    window.location.hostname === 'tauri.localhost.'
  );
}

export function isDesktopRuntime(): boolean {
  return isTauriHost();
}

export function isBrowserRuntime(): boolean {
  return !isTauriHost();
}

/**
 * iOS/iPadOS detection. Upload transport (fetch+Blob) and the sequential file
 * picker branch on this; keep it in the platform layer so features do not
 * inspect the user agent themselves.
 */
export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/**
 * Base URL for the LAN Hub API.
 *
 * - Tauri shell / Node (no `window`): loopback Hub.
 * - Page served by the Hub itself: same origin (`''`).
 * - Browser on another port (Vite dev): same host on the Hub port.
 */
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
