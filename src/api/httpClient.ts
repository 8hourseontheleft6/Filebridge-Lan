/**
 * Shared JSON HTTP client for the LAN Hub.
 *
 * Everything transport-ish lives here: URL building, bearer tokens, timeouts,
 * JSON parsing and HTTP error conversion. No business rules.
 *
 * Uploads (XHR / chunked fetch / streaming) and SSE deliberately do NOT go
 * through this client; they need their own transports.
 */
import { API_BASE } from '../platform/runtime';
import { ApiError, readServerError } from './errors';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  /** Bearer token for authorized endpoints. */
  token?: string | null;
  headers?: Record<string, string>;
  /** JSON body; serialized by the client. */
  body?: unknown;
  /** Raw body (already serialized). Takes precedence over `body`. */
  rawBody?: BodyInit;
  contentType?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  cache?: RequestCache;
  /** Absolute URL override; defaults to `${base}${path}`. */
  url?: string;
}

export interface HttpClientOptions {
  base?: string;
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 10_000;

function isJsonResponse(response: Response): boolean {
  const type = response.headers.get('content-type') || '';
  return type.includes('application/json');
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Non-JSON error bodies still carry a status; callers get a plain message.
    return text;
  }
}

export class HttpClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultTimeoutMs: number;

  constructor(options: HttpClientOptions = {}) {
    this.base = options.base ?? API_BASE;
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  buildUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    if (!this.base) return path;
    return `${this.base}${path}`;
  }

  private buildHeaders(options: RequestOptions, hasJsonBody: boolean): Headers {
    const headers = new Headers(options.headers);
    if (hasJsonBody) headers.set('Content-Type', options.contentType || 'application/json');
    else if (options.contentType) headers.set('Content-Type', options.contentType);
    if (options.token) headers.set('Authorization', `Bearer ${options.token}`);
    return headers;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? 'GET';
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const externalAbort = () => controller.abort();
    options.signal?.addEventListener('abort', externalAbort, { once: true });
    const abortedByCaller = () => Boolean(options.signal?.aborted);

    const body =
      options.rawBody !== undefined
        ? options.rawBody
        : options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined;

    let response: Response;
    try {
      response = await this.fetchImpl(this.buildUrl(options.url ?? path), {
        method,
        headers: this.buildHeaders(options, body !== undefined && !options.rawBody),
        body,
        cache: options.cache ?? 'no-store',
        signal: controller.signal,
      });
    } catch (reason) {
      const aborted = reason instanceof Error && reason.name === 'AbortError';
      if (aborted && abortedByCaller()) throw ApiError.aborted();
      if (aborted || timedOut) throw ApiError.timeout(timeoutMs);
      throw ApiError.network(reason);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', externalAbort);
    }

    const parsed = await readBody(response);

    if (!response.ok) {
      const server = readServerError(parsed);
      throw ApiError.http(response.status, {
        code: server.code,
        message: server.message,
        body: parsed,
      });
    }

    if (typeof parsed === 'string' && parsed.length > 0) {
      throw ApiError.invalidJson();
    }
    return parsed as T;
  }

  async requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, options);
  }

  async requestVoid(path: string, options: RequestOptions = {}): Promise<void> {
    await this.request<unknown>(path, options);
  }

  get<T>(path: string, options: Omit<RequestOptions, 'method'> = {}): Promise<T> {
    return this.requestJson<T>(path, { ...options, method: 'GET' });
  }

  post<T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.requestJson<T>(path, { ...options, method: 'POST', body });
  }

  del<T>(path: string, options: Omit<RequestOptions, 'method'> = {}): Promise<T> {
    return this.requestJson<T>(path, { ...options, method: 'DELETE' });
  }
}

/** Default client bound to the runtime Hub base URL. */
export const http = new HttpClient();

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  return new HttpClient(options);
}

/** Whether the response has a JSON content type (helper for dedicated transports). */
export { isJsonResponse };
