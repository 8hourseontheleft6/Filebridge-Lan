/**
 * Transport errors.
 *
 * The API layer converts HTTP/network failures into `ApiError` so services and
 * controllers never inspect `Response` objects or magic status numbers.
 */
export type ApiErrorKind =
  | 'http'
  | 'timeout'
  | 'network'
  | 'invalid-json'
  | 'aborted';

export interface ApiErrorOptions {
  kind: ApiErrorKind;
  message: string;
  status?: number | null;
  code?: string | null;
  /** Raw response body when the server returned JSON we could parse. */
  body?: unknown;
  /** Server-provided human message, if any. */
  serverMessage?: string | null;
  cause?: unknown;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly body: unknown;
  readonly serverMessage: string | null;

  constructor(options: ApiErrorOptions) {
    super(options.message);
    this.name = 'ApiError';
    this.kind = options.kind;
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.body = options.body;
    this.serverMessage = options.serverMessage ?? null;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }

  static http(
    status: number,
    options: { code?: string | null; message?: string | null; body?: unknown } = {},
  ): ApiError {
    const serverMessage = options.message ?? null;
    const message = serverMessage || `HTTP ${status}`;
    return new ApiError({
      kind: 'http',
      message,
      status,
      code: options.code ?? null,
      body: options.body,
      serverMessage,
    });
  }

  static timeout(timeoutMs: number): ApiError {
    return new ApiError({ kind: 'timeout', message: `请求超时（${timeoutMs}ms）`, status: null });
  }

  static network(cause: unknown): ApiError {
    return new ApiError({ kind: 'network', message: '无法连接 Hub，请确认服务在线', cause });
  }

  static invalidJson(cause?: unknown): ApiError {
    return new ApiError({ kind: 'invalid-json', message: '服务器返回了无法解析的响应', cause });
  }

  static aborted(): ApiError {
    return new ApiError({ kind: 'aborted', message: '请求已取消', status: null });
  }
}

/** Session is gone: the caller must drop the token and clear sensitive state. */
export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

/** Read `error`/`code` out of an arbitrary JSON body without trusting its shape. */
export function readServerError(body: unknown): { message: string | null; code: string | null } {
  if (!body || typeof body !== 'object') return { message: null, code: null };
  const record = body as { error?: unknown; code?: unknown; message?: unknown };
  const message =
    typeof record.error === 'string'
      ? record.error
      : typeof record.message === 'string'
        ? record.message
        : null;
  const code = typeof record.code === 'string' ? record.code : null;
  return { message, code };
}

export function errorText(error: unknown, fallback = '操作失败'): string {
  if (error instanceof ApiError) return error.message || fallback;
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}
