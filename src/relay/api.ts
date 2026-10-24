import { isTauriHost } from '../lib/hub';

const RELAY_STORAGE_KEY = 'filebridge_relay_base';
export const DEFAULT_RELAY_BASE = 'http://127.0.0.1:43000';

export interface CreatedTransfer {
  id: string;
  code: string;
  uploadToken: string;
  downloadToken: string;
  name: string;
  size: number;
  chunkSize: number;
  chunks: number;
  expiresAt: number;
  publicUrl: string;
}

export interface RelayMeta {
  id: string;
  code: string;
  name: string;
  size: number;
  chunkSize: number;
  chunks: number;
  completed: boolean;
  createdAt: number;
  expiresAt: number;
}

export interface RelayLink {
  code: string;
  key: string;
  token: string;
  hash: string;
}

export function normalizeRelayBase(raw: string): string {
  const value = raw.trim().replace(/\/+$/, '');
  if (!value) throw new Error('请填写中继地址');
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('中继地址必须是 http(s)');
  }
  return parsed.origin;
}

export function isRelayHosted(): boolean {
  if (isTauriHost()) return false;
  if (window.location.protocol !== 'https:') return false;
  return !['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname);
}

export function defaultRelayBase(): string {
  try {
    const saved = window.localStorage.getItem(RELAY_STORAGE_KEY);
    if (saved) return normalizeRelayBase(saved);
  } catch {
    // ignore storage failures
  }
  if (isRelayHosted()) return window.location.origin;
  return DEFAULT_RELAY_BASE;
}

export function saveRelayBase(value: string): string {
  const base = normalizeRelayBase(value);
  window.localStorage.setItem(RELAY_STORAGE_KEY, base);
  return base;
}

export function parseRelayHash(hash = window.location.hash): RelayLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const code = params.get('receive');
  if (!code) return null;
  return {
    code: code.trim().toUpperCase(),
    key: params.get('key') || '',
    token: params.get('token') || '',
    hash: params.get('hash') || '',
  };
}

export function buildRelayLink(base: string, code: string, key: string, token: string, hash: string): string {
  return `${normalizeRelayBase(base)}/#receive=${encodeURIComponent(code)}&key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}&hash=${encodeURIComponent(hash)}`;
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const data = JSON.parse(text) as { error?: string };
    if (data?.error) return data.error;
  } catch {
    // fall through
  }
  return text || `HTTP ${response.status}`;
}

async function checkedJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as T;
}

export async function createRelayTransfer(
  base: string,
  input: { name: string; size: number; chunkSize: number },
  accessToken = '',
  signal?: AbortSignal,
): Promise<CreatedTransfer> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(`${normalizeRelayBase(base)}/api/transfers`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
    signal,
  });
  return checkedJson<CreatedTransfer>(response);
}

export async function uploadRelayChunk(
  base: string,
  id: string,
  index: number,
  data: ArrayBuffer,
  uploadToken: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(
    `${normalizeRelayBase(base)}/api/transfers/${encodeURIComponent(id)}/chunks/${index}`,
    {
      method: 'PUT',
      headers: {
        'X-Upload-Token': uploadToken,
        'Content-Type': 'application/octet-stream',
      },
      body: data,
      signal,
    },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
}

export async function completeRelayTransfer(
  base: string,
  id: string,
  uploadToken: string,
  signal?: AbortSignal,
): Promise<RelayMeta> {
  const response = await fetch(
    `${normalizeRelayBase(base)}/api/transfers/${encodeURIComponent(id)}/complete`,
    {
      method: 'POST',
      headers: { 'X-Upload-Token': uploadToken },
      signal,
    },
  );
  return checkedJson<RelayMeta>(response);
}

export async function getRelayByCode(base: string, code: string, token: string): Promise<RelayMeta> {
  const response = await fetch(
    `${normalizeRelayBase(base)}/api/transfers/code/${encodeURIComponent(code.toUpperCase())}`,
    { cache: 'no-store', headers: { 'X-Download-Token': token } },
  );
  return checkedJson<RelayMeta>(response);
}

export async function downloadRelayChunk(
  base: string,
  id: string,
  index: number,
  code: string,
  token: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const response = await fetch(
    `${normalizeRelayBase(base)}/api/transfers/${encodeURIComponent(id)}/chunks/${index}?code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`,
    { cache: 'no-store', signal },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.arrayBuffer();
}

export async function deleteRelayTransfer(
  base: string,
  id: string,
  uploadToken: string,
): Promise<void> {
  const response = await fetch(
    `${normalizeRelayBase(base)}/api/transfers/${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: { 'X-Upload-Token': uploadToken } },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
}
