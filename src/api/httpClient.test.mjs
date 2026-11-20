import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, isAuthError, readServerError } from './errors.ts';
import { HttpClient, createHttpClient } from './httpClient.ts';

const BASE = 'http://hub.test';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(handler, options = {}) {
  const calls = [];
  const client = createHttpClient({
    base: BASE,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    },
    defaultTimeoutMs: 1000,
    ...options,
  });
  return { client, calls };
}

test('successful JSON GET builds the Hub URL and keeps cache disabled', async () => {
  const { client, calls } = makeClient(() => json({ ok: true }));
  const result = await client.get('/api/info');
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${BASE}/api/info`);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(calls[0].init.headers.get('Authorization'), null);
});

test('bearer token is added as an Authorization header', async () => {
  const { client, calls } = makeClient(() => json({ ok: true }));
  await client.get('/api/files', { token: 'secret-token' });
  assert.equal(calls[0].init.headers.get('Authorization'), 'Bearer secret-token');
});

test('POST sends JSON content type and body', async () => {
  const { client, calls } = makeClient(() => json({ enabled: true }));
  await client.post('/api/clipboard/enabled', { enabled: true }, { token: 't' });
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.get('Content-Type'), 'application/json');
  assert.equal(calls[0].init.body, JSON.stringify({ enabled: true }));
});

test('401 keeps status and server error code', async () => {
  const { client } = makeClient(() => json({ error: '未授权', code: 'unauthorized' }, 401));
  await assert.rejects(
    () => client.get('/api/files', { token: 't' }),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.kind, 'http');
      assert.equal(error.status, 401);
      assert.equal(error.code, 'unauthorized');
      assert.equal(error.message, '未授权');
      assert.equal(isAuthError(error), true);
      return true;
    },
  );
});

test('409/413/429 business statuses are preserved', async () => {
  const cases = [
    [409, 'upload_offset_mismatch'],
    [413, 'clipboard_too_large'],
    [429, 'clipboard_rate_limited'],
  ];
  for (const [status, code] of cases) {
    const { client } = makeClient(() => json({ error: `failed-${status}`, code }, status));
    await assert.rejects(
      () => client.get('/api/clipboard', { token: 't' }),
      (error) => {
        assert.equal(error.status, status);
        assert.equal(error.code, code);
        return true;
      },
    );
  }
});

test('timeouts surface as ApiError kind timeout', async () => {
  const { client } = makeClient(
    (url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  );
  await assert.rejects(
    () => client.get('/api/info', { timeoutMs: 10 }),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.kind, 'timeout');
      assert.match(error.message, /超时/);
      return true;
    },
  );
});

test('network failures surface as ApiError kind network', async () => {
  const { client } = makeClient(() => {
    throw new TypeError('failed to fetch');
  });
  await assert.rejects(
    () => client.get('/api/info'),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.kind, 'network');
      assert.equal(error.status, null);
      return true;
    },
  );
});

test('non-JSON success bodies are rejected as invalid-json', async () => {
  const { client } = makeClient(
    () => new Response('<html>not json</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
  );
  await assert.rejects(
    () => client.get('/api/info'),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.kind, 'invalid-json');
      return true;
    },
  );
});

test('empty 204 resolves for requestVoid and DELETE', async () => {
  const { client, calls } = makeClient(() => new Response(null, { status: 204 }));
  await client.requestVoid('/api/files/abc', { method: 'DELETE', token: 't' });
  assert.equal(calls[0].init.method, 'DELETE');
});

test('non-JSON error body still yields an http ApiError', async () => {
  const { client } = makeClient(() => new Response('boom', { status: 500, headers: { 'content-type': 'text/plain' } }));
  await assert.rejects(
    () => client.get('/api/info'),
    (error) => {
      assert.equal(error.status, 500);
      assert.equal(error.message, 'HTTP 500');
      return true;
    },
  );
});

test('tokens and bodies are never embedded in error messages', async () => {
  const token = 'very-secret-token';
  const body = { text: 'private clipboard text' };
  const { client } = makeClient(() => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(
    () => client.post('/api/clipboard', body, { token }),
    (error) => {
      assert.equal(error.message.includes(token), false);
      assert.equal(error.message.includes(body.text), false);
      assert.equal(JSON.stringify(error).includes(token), false);
      return true;
    },
  );
});

test('readServerError tolerates arbitrary bodies', () => {
  assert.deepEqual(readServerError(null), { message: null, code: null });
  assert.deepEqual(readServerError('text'), { message: null, code: null });
  assert.deepEqual(readServerError({ message: 'm', code: 'c' }), { message: 'm', code: 'c' });
  assert.deepEqual(readServerError({ error: 'e' }), { message: 'e', code: null });
});

test('custom HttpClient instance uses the provided base', async () => {
  const client = new HttpClient({ base: 'http://other:1', fetchImpl: async () => json({}) });
  assert.equal(client.buildUrl('/api/info'), 'http://other:1/api/info');
  assert.equal(client.buildUrl('http://absolute/x'), 'http://absolute/x');
});
