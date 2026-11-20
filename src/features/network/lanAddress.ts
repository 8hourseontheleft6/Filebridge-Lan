/**
 * LAN address helpers.
 *
 * The Hub already filters virtual adapters and orders candidates by default
 * route; this module only applies the UI-side safety net and turns the chosen
 * host into the phone URL / QR base.
 */
import { HUB_PORT } from '../../platform/runtime';

function isLocalHost(host: string): boolean {
  return !host || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

function isIPv4(value: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(value);
}

function isPrivateIPv4(value: string): boolean {
  return (
    /^10\./.test(value) ||
    /^192\.168\./.test(value) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(value)
  );
}

/**
 * Accept only private IPv4 candidates from the Hub, skipping loopback,
 * link-local, unspecified and multicast addresses.
 */
export function listPhoneHosts(ips: readonly string[] | null | undefined): string[] {
  const candidates: string[] = [];
  for (const ip of ips || []) {
    const value = String(ip || '');
    if (!isIPv4(value)) continue;
    if (!isPrivateIPv4(value)) continue;
    if (value.startsWith('127.') || value.startsWith('0.')) continue;
    if (value.startsWith('169.254.')) continue;
    if (value.startsWith('224.') || value.startsWith('239.') || value.startsWith('255.')) continue;
    const octets = value.split('.').map(Number);
    if (octets.some((octet) => octet > 255)) continue;
    if (candidates.includes(value)) continue;
    candidates.push(value);
  }
  // Keep the Hub order, but move the VirtualBox default Host-Only subnet last
  // so a stale Hub cannot make the QR point at the virtual adapter.
  const real = candidates.filter((value) => !value.startsWith('192.168.56.'));
  const virtualLooking = candidates.filter((value) => value.startsWith('192.168.56.'));
  return [...real, ...virtualLooking];
}

/** First address a phone can actually open. */
export function pickPhoneHost(ips: readonly string[] | null | undefined): string {
  return listPhoneHosts(ips)[0] || '';
}

export interface PhoneInfo {
  ips: string[];
  port?: number;
}

/**
 * Build the phone base URL. When the Hub has no usable address the page own
 * private hostname is used; otherwise an empty string means "no QR code".
 */
export function resolvePhoneBase(info?: PhoneInfo | null): string {
  const fromHub = pickPhoneHost(info?.ips);
  const host = fromHub || (!isLocalHost(window.location.hostname) && isPrivateIPv4(window.location.hostname)
    ? window.location.hostname
    : '');
  if (!host) return '';

  // Dev: the page runs on Vite (5173); phones must use the same port so they do
  // not open a stale dist. Tauri/Hub-served pages use the Hub port.
  const currentPort = window.location.port;
  const port = currentPort && currentPort !== String(HUB_PORT)
    ? currentPort
    : (info?.port || HUB_PORT);
  return `http://${host}:${port}`;
}
