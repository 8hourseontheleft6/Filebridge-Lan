import assert from 'node:assert/strict';
import test from 'node:test';

import { ChunkUploadError } from '../../api/uploadApi.ts';
import {
  UploadCancelledError,
  advanceUploadQueue,
  createUploadQueue,
  createUploadState,
  uploadFile,
} from './uploadsService.ts';

const SAVED = {
  id: 'saved',
  name: 'a.bin',
  size: 8,
  sha256: 'sha',
  mime: 'application/octet-stream',
  createdAt: 1,
};

function fakeFile(size = 8, name = 'a.bin') {
  return { name, size, type: '', slice: () => ({}) };
}

function incomplete(offset = 0) {
  return { offset, complete: false, diagnostics: null };
}

function makePorts(overrides = {}) {
  const updates = [];
  const ports = {
    transport: 'xhr-blob',
    chunkSize: 4,
    sendChunk: async () => ({ offset: 8, complete: true, file: SAVED }),
    queryOffset: async () => incomplete(0),
    isCancelled: () => false,
    onUnauthorized: () => {},
    onUpdate: (update) => {
      updates.push(update);
    },
    sleep: async () => {},
    ...overrides,
  };
  return { ports, updates };
}

function objectPatches(updates) {
  return updates.filter((update) => typeof update === 'object');
}

/** Resolve updater patches against the running state, like the controller does. */
function resolvedPatches(updates) {
  let state = {
    loaded: 0,
    inFlightLoaded: 0,
    offset: 0,
    confirmedOffset: 0,
    status: 'uploading',
    serverDiag: null,
  };
  return updates.map((update) => {
    const patch = typeof update === 'function' ? update(state) : update;
    state = { ...state, ...patch };
    return patch;
  });
}

test('one chunk completion returns the saved file and confirmed offset', async () => {
  const { ports, updates } = makePorts();
  const result = await uploadFile(fakeFile(), 'id', 0, undefined, ports);
  assert.equal(result, SAVED);
  const patch = objectPatches(updates).find((entry) => entry.offset === 8);
  assert.equal(patch?.confirmedOffset, 8);
  assert.equal(patch?.status, 'uploading');
});

test('409 offset conflict restarts from the server offset', async () => {
  const sends = [];
  let attempt = 0;
  const { ports } = makePorts({
    sendChunk: async (_file, _id, offset) => {
      sends.push(offset);
      attempt += 1;
      if (attempt === 1) {
        throw new ChunkUploadError({ kind: 'http', status: 409, offset: 4 });
      }
      return { offset: 8, complete: true, file: SAVED };
    },
    queryOffset: async () => incomplete(4),
  });

  const result = await uploadFile(fakeFile(), 'id', 0, undefined, ports);
  assert.equal(result, SAVED);
  assert.deepEqual(sends, [0, 4]);
});

test('failed chunks reconcile with the server before retrying', async () => {
  let attempts = 0;
  const sleeps = [];
  const { ports, updates } = makePorts({
    sendChunk: async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new ChunkUploadError({ kind: 'network', message: '网络中断，进度已保留，可继续上传' });
      }
      return { offset: 8, complete: true, file: SAVED };
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  const result = await uploadFile(fakeFile(), 'id', 0, undefined, ports);
  assert.equal(result, SAVED);
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [700, 1400]);
  assert.ok(resolvedPatches(updates).some((entry) => entry.status === 'retrying'));
});

test('a server-complete state after a failure returns the file without another chunk', async () => {
  let sends = 0;
  const { ports } = makePorts({
    sendChunk: async () => {
      sends += 1;
      throw new ChunkUploadError({ kind: 'network', message: 'down' });
    },
    queryOffset: async () => ({ offset: 8, complete: true, file: SAVED, diagnostics: null }),
  });

  const result = await uploadFile(fakeFile(), 'id', 0, undefined, ports);
  assert.equal(result, SAVED);
  assert.equal(sends, 1);
});

test('cancellation before the first chunk throws without sending', async () => {
  let sent = false;
  const { ports } = makePorts({
    isCancelled: () => true,
    sendChunk: async () => {
      sent = true;
      return { offset: 8, complete: true, file: SAVED };
    },
  });

  await assert.rejects(uploadFile(fakeFile(), 'id', 0, undefined, ports), UploadCancelledError);
  assert.equal(sent, false);
});

test('an XHR abort becomes a cancellation without reconciling', async () => {
  let queried = 0;
  const { ports } = makePorts({
    sendChunk: async () => {
      throw new ChunkUploadError({ kind: 'aborted', message: '请求已取消' });
    },
    queryOffset: async () => {
      queried += 1;
      return incomplete(0);
    },
  });

  await assert.rejects(uploadFile(fakeFile(), 'id', 0, undefined, ports), UploadCancelledError);
  assert.equal(queried, 0);
});

test('XHR 401 expires the session and retries; fetch 401 does not expire', async () => {
  async function run(transport) {
    let attempts = 0;
    let unauthorized = 0;
    const { ports } = makePorts({
      transport,
      sendChunk: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new ChunkUploadError({
            kind: 'http',
            status: 401,
            serverMessage: '未授权',
            message: '未授权',
          });
        }
        return { offset: 8, complete: true, file: SAVED };
      },
      onUnauthorized: () => {
        unauthorized += 1;
      },
    });
    const result = await uploadFile(fakeFile(), 'id', 0, undefined, ports);
    return { result, attempts, unauthorized };
  }

  const xhr = await run('xhr-blob');
  assert.equal(xhr.result, SAVED);
  assert.equal(xhr.attempts, 2);
  assert.equal(xhr.unauthorized, 1);

  const fetchResult = await run('fetch-blob');
  assert.equal(fetchResult.result, SAVED);
  assert.equal(fetchResult.attempts, 2);
  assert.equal(fetchResult.unauthorized, 0);
});

test('fetch 409 asks the status endpoint for the authoritative offset', async () => {
  const sends = [];
  let attempt = 0;
  let queries = 0;
  const { ports } = makePorts({
    transport: 'fetch-blob',
    sendChunk: async (_file, _id, offset) => {
      sends.push(offset);
      attempt += 1;
      if (attempt === 1) {
        throw new ChunkUploadError({ kind: 'http', status: 409, offset: null });
      }
      return { offset: 8, complete: true, file: SAVED };
    },
    queryOffset: async () => {
      queries += 1;
      return queries === 1 ? incomplete(4) : incomplete(4);
    },
  });

  const result = await uploadFile(fakeFile(), 'id', 0, undefined, ports);
  assert.equal(result, SAVED);
  assert.deepEqual(sends, [0, 4]);
});

test('the retry budget marks the upload failed with the transport message', async () => {
  let attempts = 0;
  const sleeps = [];
  const { ports, updates } = makePorts({
    sendChunk: async () => {
      attempts += 1;
      throw new ChunkUploadError({ kind: 'network', message: '网络中断，进度已保留，可继续上传' });
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  await assert.rejects(
    uploadFile(fakeFile(), 'id', 0, undefined, ports),
    /网络中断，进度已保留，可继续上传/,
  );
  assert.equal(attempts, 4);
  assert.deepEqual(sleeps, [700, 1400, 2100]);
  const errorPatch = objectPatches(updates).find((entry) => entry.status === 'error');
  assert.equal(errorPatch?.error, '网络中断，进度已保留，可继续上传');
});

test('a final zero-length chunk finalizes a lost completion response', async () => {
  const sends = [];
  const { ports } = makePorts({
    sendChunk: async (_file, _id, offset) => {
      sends.push(offset);
      if (offset === 0) return { offset: 4, complete: false };
      return { offset: 4, complete: true, file: SAVED };
    },
    queryOffset: async () => incomplete(4),
  });

  const result = await uploadFile(fakeFile(4), 'id', 0, undefined, ports);
  assert.equal(result, SAVED);
  assert.deepEqual(sends, [0, 4]);
});

test('initial state keeps the batch bookkeeping', () => {
  const file = fakeFile(8, 'video.mov');
  const state = createUploadState(file, 'id', 4, {
    index: 2,
    count: 3,
    totalBytes: 30,
    baseBytes: 10,
    startedAt: 1000,
  });
  assert.equal(state.startedAt, 1000);
  assert.equal(state.batchIndex, 2);
  assert.equal(state.batchCount, 3);
  assert.equal(state.batchTotal, 30);
  assert.equal(state.batchBase, 10);
  assert.equal(state.batchStartedAt, 1000);
  assert.equal(state.confirmedOffset, 4);
  assert.equal(state.inFlightLoaded, 4);
  assert.equal(state.status, 'uploading');
});

test('queue helpers keep totals and advance the index', () => {
  const files = [fakeFile(4), fakeFile(6)];
  const queue = createUploadQueue(files, 0, 0, 500);
  assert.equal(queue.totalBytes, 10);
  assert.equal(queue.startedAt, 500);
  const next = advanceUploadQueue(queue, 1, 4);
  assert.equal(next.index, 1);
  assert.equal(next.completedBytes, 4);
  assert.equal(next.totalBytes, 10);
  assert.equal(next.startedAt, 500);
});
