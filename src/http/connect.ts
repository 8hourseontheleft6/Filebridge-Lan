import { API_BASE } from '../lib/hub';

export interface ConnectRequestCreated {
  requestId: string;
  requestSecret: string;
  expiresAt: number;
}

export type ConnectStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface ConnectRequestStatus {
  status: ConnectStatus;
  token?: string;
  expiresAt?: number;
}

export interface PendingConnectRequest {
  id: string;
  name: string;
  ip: string;
  createdAt: number;
  expiresAt: number;
}

function errorText(status: number, body: unknown): string {
  if (body && typeof body === 'object' && 'error' in body) {
    return String((body as { error?: unknown }).error || '');
  }
  if (status === 401 || status === 403) return '没有权限执行这个连接操作';
  if (status === 404) return '连接请求不存在或已失效';
  if (status === 409) return '连接请求已经被处理';
  if (status === 410) return '连接请求已过期';
  if (status === 429) return '请求过于频繁，请稍后再试';
  return `连接请求失败（${status}）`;
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function deviceDisplayName(): string {
  const ua = navigator.userAgent || '';
  if (/Windows/i.test(ua)) return 'Windows 电脑';
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac 电脑';
  if (/Android/i.test(ua)) return 'Android 设备';
  if (/iPhone|iPad/i.test(ua)) return 'iPhone / iPad';
  if (/Linux/i.test(ua)) return 'Linux 电脑';
  return '另一台电脑';
}

export async function createConnectRequest(
  base = API_BASE,
  name = deviceDisplayName()
): Promise<ConnectRequestCreated> {
  const response = await fetch(`${base}/api/connect/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const body = await readBody(response);
  if (!response.ok) throw new Error(errorText(response.status, body));
  return body as ConnectRequestCreated;
}

export async function getConnectStatus(
  request: ConnectRequestCreated,
  base = API_BASE
): Promise<ConnectRequestStatus> {
  const response = await fetch(`${base}/api/connect/requests/${request.requestId}`, {
    headers: { 'X-Connect-Secret': request.requestSecret },
  });
  const body = await readBody(response);
  if (!response.ok) throw new Error(errorText(response.status, body));
  return body as ConnectRequestStatus;
}

export async function listConnectRequests(base = API_BASE): Promise<PendingConnectRequest[]> {
  const response = await fetch(`${base}/api/connect/requests`, { cache: 'no-store' });
  const body = await readBody(response);
  if (!response.ok) throw new Error(errorText(response.status, body));
  return (body as { requests?: PendingConnectRequest[] }).requests || [];
}

export async function decideConnectRequest(
  id: string,
  approve: boolean,
  base = API_BASE
): Promise<void> {
  const response = await fetch(`${base}/api/connect/requests/${id}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approve }),
  });
  const body = await readBody(response);
  if (!response.ok) throw new Error(errorText(response.status, body));
}
