/**
 * Connection request API (`/api/connect/requests`).
 *
 * Used when opening another computer's Hub: create a request, poll its status,
 * and (on the host) list and approve/deny pending requests.
 */
import { API_BASE } from '../platform/runtime';
import { ApiError, errorText, readServerError } from './errors';
import { http } from './httpClient';

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

/** Device name shown to the host in the approval prompt. */
export function deviceDisplayName(): string {
  const ua = navigator.userAgent || '';
  if (/Windows/i.test(ua)) return 'Windows 电脑';
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac 电脑';
  if (/Android/i.test(ua)) return 'Android 设备';
  if (/iPhone|iPad/i.test(ua)) return 'iPhone / iPad';
  if (/Linux/i.test(ua)) return 'Linux 电脑';
  return '另一台电脑';
}

function connectionError(error: unknown): Error {
  if (!(error instanceof ApiError)) return error instanceof Error ? error : new Error(String(error));
  const { code } = error;
  const server = readServerError(error.body);
  if (server.message) return new Error(server.message);
  if (error.status === 401 || error.status === 403) return new Error('没有权限执行这个连接操作');
  if (error.status === 404) return new Error('连接请求不存在或已失效');
  if (error.status === 409) return new Error('连接请求已经被处理');
  if (error.status === 410) return new Error('连接请求已过期');
  if (error.status === 429) return new Error('请求过于频繁，请稍后再试');
  if (code) return new Error(errorText(error));
  return new Error(`连接请求失败（${error.status ?? 0}）`);
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw connectionError(error);
  }
}

export async function createConnectRequest(
  base = API_BASE,
  name = deviceDisplayName(),
): Promise<ConnectRequestCreated> {
  return call(() =>
    http.post<ConnectRequestCreated>(`${base}/api/connect/requests`, { name }, { timeoutMs: 8000 }),
  );
}

export async function getConnectStatus(
  request: Pick<ConnectRequestCreated, 'requestId' | 'requestSecret'>,
  base = API_BASE,
): Promise<ConnectRequestStatus> {
  return call(() =>
    http.get<ConnectRequestStatus>(`${base}/api/connect/requests/${encodeURIComponent(request.requestId)}`, {
      headers: { 'X-Connect-Secret': request.requestSecret },
      timeoutMs: 8000,
    }),
  );
}

export async function listConnectRequests(base = API_BASE): Promise<PendingConnectRequest[]> {
  return call(async () => {
    const body = await http.get<{ requests?: PendingConnectRequest[] }>(
      `${base}/api/connect/requests`,
      { timeoutMs: 8000 },
    );
    return body?.requests || [];
  });
}

export async function decideConnectRequest(
  id: string,
  approve: boolean,
  base = API_BASE,
): Promise<void> {
  return call(() =>
    http.requestVoid(`${base}/api/connect/requests/${encodeURIComponent(id)}/decision`, {
      method: 'POST',
      body: { approve },
      timeoutMs: 8000,
    }),
  );
}
