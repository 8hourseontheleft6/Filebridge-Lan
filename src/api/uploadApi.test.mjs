import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ChunkUploadError,
  chunkUploadUrl,
  uploadChunkFetch,
  uploadChunkXhr,
} from './uploadApi.ts';

const FILE = {
  name: 'a b.bin',
  size: 8,
  type: 'text/plain',
  slice: () => ({ chunk: true }),
};

class FakeXhr {
  static last = null;

  constructor() {
    FakeXhr.last = this;
    this.upload = {};
    this.headers = {};
    this.status = 0;
    this.responseText = '';
  }

  open(method, url) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name, value) {
    this.headers[name] = value;
  }

  send(chunk) {
    this.sent = chunk;
  }

  abort() {
    this.onabort?.();
  }
}

async function withFakeXhr(run) {
  const original = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = FakeXhr;
  FakeXhr.last = null;
  try {
    return await run();
  } finally {
    globalThis.XMLHttpRequest = original;
  }
}

function request(overrides = {}) {
  return {
    token: 'tok',
    file: FILE,
    uploadId: 'id',
    offset: 0,
    chunkSize: 4,
    ...overrides,
  };
}

test('chunk URL keeps the historical field order and %20 encoding', () => {
  const url = chunkUploadUrl(
    { name: 'a b&c.bin', uploadId: 'id-1', offset: 4, total: 8 },
    '',
  );
  assert.equal(url, '/api/upload/chunk?name=a%20b%26c.bin&id=id-1&offset=4&total=8');
});

test('XHR success resolves the parsed body and reports the phases', async () => {
  await withFakeXhr(async () => {
    const phases = [];
    const promise = uploadChunkXhr(request({ onPhase: (phase) => phases.push(phase) }));
    const xhr = FakeXhr.last;
    assert.equal(xhr.method, 'POST');
    assert.ok(xhr.url.endsWith('/api/upload/chunk?name=a%20b.bin&id=id&offset=0&total=8'));
    assert.equal(xhr.headers.Authorization, 'Bearer tok');
    assert.equal(xhr.headers['Content-Type'], 'text/plain');

    xhr.status = 201;
    xhr.responseText = JSON.stringify({ offset: 4, complete: true });
    xhr.onload();

    assert.deepEqual(await promise, { offset: 4, complete: true });
    assert.deepEqual(phases, ['created', 'response-received']);
  });
});

test('XHR 409 exposes the server offset', async () => {
  await withFakeXhr(async () => {
    const promise = uploadChunkXhr(request());
    const xhr = FakeXhr.last;
    xhr.status = 409;
    xhr.responseText = JSON.stringify({ offset: 4, error: 'offset mismatch' });
    xhr.onload();

    await assert.rejects(promise, (error) => {
      assert.ok(error instanceof ChunkUploadError);
      assert.equal(error.status, 409);
      assert.equal(error.offset, 4);
      return true;
    });
  });
});

test('XHR 401 keeps the status and server message for the service', async () => {
  await withFakeXhr(async () => {
    const promise = uploadChunkXhr(request());
    const xhr = FakeXhr.last;
    xhr.status = 401;
    xhr.responseText = JSON.stringify({ error: '未授权' });
    xhr.onload();

    await assert.rejects(promise, (error) => {
      assert.ok(error instanceof ChunkUploadError);
      assert.equal(error.status, 401);
      assert.equal(error.serverMessage, '未授权');
      return true;
    });
  });
});

test('an aborted XHR rejects as a transport abort', async () => {
  await withFakeXhr(async () => {
    const promise = uploadChunkXhr(request());
    FakeXhr.last.abort();

    await assert.rejects(promise, (error) => {
      assert.ok(error instanceof ChunkUploadError);
      assert.equal(error.kind, 'aborted');
      return true;
    });
  });
});

test('an already-aborted signal rejects before sending', async () => {
  await withFakeXhr(async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      uploadChunkXhr(request({ signal: controller.signal })),
      (error) => error instanceof ChunkUploadError && error.kind === 'aborted',
    );
    assert.equal(FakeXhr.last, null);
  });
});

test('XHR without a token rejects before creating a request', async () => {
  await withFakeXhr(async () => {
    await assert.rejects(uploadChunkXhr(request({ token: '' })), /缺少访问授权/);
    assert.equal(FakeXhr.last, null);
  });
});

test('fetch transport posts a blob then reconciles through the status GET', async () => {
  const calls = [];
  const original = globalThis.fetch;
  const saved = {
    id: 'saved',
    name: 'a b.bin',
    size: 8,
    sha256: 'sha',
    mime: 'text/plain',
    createdAt: 1,
  };
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (init?.method === 'POST') {
      return new Response(null, { status: 200 });
    }
    return new Response(
      JSON.stringify({ offset: 8, complete: true, file: saved }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  try {
    const result = await uploadChunkFetch(request());
    assert.deepEqual(result, { offset: 8, complete: true, file: saved });
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
    assert.ok(calls[0].url.endsWith('/api/upload/chunk?name=a%20b.bin&id=id&offset=0&total=8'));
    assert.ok(calls[1].url.endsWith('/api/upload/chunk/id'));
  } finally {
    globalThis.fetch = original;
  }
});
