import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../../api/errors.ts';
import {
  allSelected,
  clearSelection,
  deleteFileById,
  deleteFiles,
  filesAfterDeleteMissing,
  filesAfterDeleteOne,
  filesAfterRefresh,
  pruneSelection,
  refreshFiles,
  selectAllFiles,
  selectedFiles,
  toggleAllFiles,
  toggleSelection,
} from './filesService.ts';

const FILE_A = { id: 'a', name: 'a.bin', size: 10, sha256: 'sha-a', mime: 'application/octet-stream', createdAt: 1 };
const FILE_B = { id: 'b', name: 'b.bin', size: 20, sha256: 'sha-b', mime: 'application/octet-stream', createdAt: 2 };
const FILE_C = { id: 'c', name: 'c.bin', size: 30, sha256: 'sha-c', mime: 'application/octet-stream', createdAt: 3 };

function fakeApi(overrides = {}) {
  const calls = [];
  return {
    calls,
    listFiles: async (token, options) => {
      calls.push(['list', token, options]);
      return [FILE_A, FILE_B];
    },
    deleteFile: async (token, id) => {
      calls.push(['delete', token, id]);
    },
    ...overrides,
  };
}

function state(files = [FILE_A, FILE_B], selected = []) {
  return { files, selectedIds: new Set(selected), batchDeleting: false };
}

test('initial load returns the file list', async () => {
  const api = fakeApi();
  const result = await refreshFiles('tok', api);
  assert.equal(result.kind, 'ok');
  assert.deepEqual(result.kind === 'ok' ? result.files.map((f) => f.id) : [], ['a', 'b']);
  assert.deepEqual(api.calls[0], ['list', 'tok', {}]);
});

test('refresh forwards the probe timeout to the transport', async () => {
  const api = fakeApi();
  await refreshFiles('tok', api, { timeoutMs: 2000 });
  assert.deepEqual(api.calls[0], ['list', 'tok', { timeoutMs: 2000 }]);
});

test('empty token skips the request entirely', async () => {
  const api = fakeApi();
  const result = await refreshFiles('', api);
  assert.equal(result.kind, 'skipped');
  assert.equal(api.calls.length, 0);
});

test('refresh success replaces the list and prunes the selection', async () => {
  const before = state([FILE_A, FILE_B, FILE_C], ['a', 'c']);
  const after = filesAfterRefresh(before, { kind: 'ok', files: [FILE_A, FILE_B] });
  assert.deepEqual(after.files.map((f) => f.id), ['a', 'b']);
  assert.deepEqual([...after.selectedIds], ['a']);
});

test('refresh failure keeps the existing list and selection', async () => {
  const before = state([FILE_A, FILE_B], ['b']);
  const failed = filesAfterRefresh(before, { kind: 'error', message: 'boom' });
  assert.equal(failed, before);
  assert.deepEqual(failed.files.map((f) => f.id), ['a', 'b']);
  assert.deepEqual([...failed.selectedIds], ['b']);

  const unauthorized = filesAfterRefresh(before, { kind: 'unauthorized' });
  assert.equal(unauthorized, before);
});

test('select one file toggles on and off', () => {
  const empty = state();
  const selected = toggleSelection(empty, 'a');
  assert.deepEqual([...selected.selectedIds], ['a']);
  const cleared = toggleSelection(selected, 'a');
  assert.deepEqual([...cleared.selectedIds], []);
});

test('select all, toggle all and clear selection', () => {
  const empty = state();
  const all = selectAllFiles(empty);
  assert.deepEqual([...all.selectedIds], ['a', 'b']);
  assert.equal(allSelected(all.files, all.selectedIds), true);

  const toggled = toggleAllFiles(all);
  assert.deepEqual([...toggled.selectedIds], []);
  assert.equal(allSelected(toggled.files, toggled.selectedIds), false);

  const selected = toggleSelection(empty, 'a');
  assert.deepEqual([...clearSelection(selected).selectedIds], []);
});

test('selected files keep list order', () => {
  assert.deepEqual(selectedFiles([FILE_A, FILE_B, FILE_C], new Set(['c', 'a'])).map((f) => f.id), ['a', 'c']);
});

test('prune only drops ids that disappeared', () => {
  const next = pruneSelection(new Set(['a', 'b', 'missing']), [FILE_B, FILE_A]);
  assert.deepEqual([...next].sort(), ['a', 'b']);
});

test('single delete returns ok and removes the id from the selection', async () => {
  const api = fakeApi();
  const result = await deleteFileById('tok', 'a', api);
  assert.equal(result.kind, 'ok');
  assert.deepEqual(api.calls[0], ['delete', 'tok', 'a']);
  const after = filesAfterDeleteOne(state([FILE_A, FILE_B], ['a', 'b']), 'a');
  assert.deepEqual([...after.selectedIds], ['b']);
});

test('single delete failure keeps the original message', async () => {
  const api = fakeApi({ deleteFile: async () => { throw new Error('500'); } });
  const result = await deleteFileById('tok', 'a', api);
  assert.equal(result.kind, 'error');
  assert.equal(result.kind === 'error' ? result.message : '', '删除失败，请稍后重试');
});

test('batch delete counts successes and clears the selection', async () => {
  const api = fakeApi();
  const result = await deleteFiles('tok', [FILE_A, FILE_B], api);
  assert.deepEqual(result, { kind: 'ok', deleted: 2, total: 2 });
  assert.equal(api.calls.length, 2);
  const after = filesAfterDeleteMissing(state([FILE_A, FILE_B], ['a', 'b']));
  assert.deepEqual([...after.selectedIds], []);
});

test('batch delete stops at the first failure with the per-file copy', async () => {
  const api = fakeApi({
    deleteFile: async (_token, id) => {
      if (id === 'b') throw new Error('nope');
    },
  });
  const result = await deleteFiles('tok', [FILE_A, FILE_B, FILE_C], api);
  assert.equal(result.kind, 'error');
  assert.deepEqual(result, { kind: 'error', deleted: 1, total: 3, message: '删除 b.bin 失败' });
});

test('401 during refresh is reported as unauthorized (not an empty success)', async () => {
  const api = fakeApi({ listFiles: async () => { throw ApiError.http(401); } });
  const result = await refreshFiles('stale', api);
  assert.equal(result.kind, 'unauthorized');
  // A token rejection must never look like "the list is empty".
  assert.notEqual(result.kind, 'ok');
});

test('403 from the Host/Origin guard is not mistaken for an expired token', async () => {
  const api = fakeApi({ listFiles: async () => { throw ApiError.http(403, { message: 'Host 不允许' }); } });
  const result = await refreshFiles('tok', api);
  assert.equal(result.kind, 'error');
  // Only the 401 path may expire the session; 403 stays a probe failure.
  assert.notEqual(result.kind, 'unauthorized');
});

test('403 during single delete stays a delete error', async () => {
  const api = fakeApi({ deleteFile: async () => { throw ApiError.http(403); } });
  const result = await deleteFileById('tok', 'a', api);
  assert.equal(result.kind, 'error');
  assert.equal(result.kind === 'error' ? result.message : '', '删除失败，请稍后重试');
});

test('401 during single delete is unauthorized', async () => {
  const api = fakeApi({ deleteFile: async () => { throw ApiError.http(401); } });
  const result = await deleteFileById('tok', 'a', api);
  assert.equal(result.kind, 'unauthorized');
});

test('service unavailable maps to an explicit error, not a fake success', async () => {
  const offline = fakeApi({ listFiles: async () => { throw new ApiError({ kind: 'network', message: 'offline' }); } });
  const networkResult = await refreshFiles('tok', offline);
  assert.equal(networkResult.kind, 'error');
  assert.equal(networkResult.kind === 'error' ? networkResult.message : '', '无法连接 Hub，请确认服务在线');

  const slow = fakeApi({ listFiles: async () => { throw new ApiError({ kind: 'timeout', message: 'slow' }); } });
  const timeoutResult = await refreshFiles('tok', slow);
  assert.equal(timeoutResult.kind, 'error');
  assert.equal(timeoutResult.kind === 'error' ? timeoutResult.message : '', '读取文件列表超时，请稍后重试');

  const failing = fakeApi({ listFiles: async () => { throw new Error('HTTP 500'); } });
  const errorResult = await refreshFiles('tok', failing);
  assert.equal(errorResult.kind, 'error');
  assert.equal(errorResult.kind === 'error' ? errorResult.message : '', 'HTTP 500');
});

test('batch delete 401 returns progress without clearing the selection', async () => {
  const api = fakeApi({
    deleteFile: async (_token, id) => {
      if (id === 'b') throw ApiError.http(401);
    },
  });
  const result = await deleteFiles('tok', [FILE_A, FILE_B], api);
  assert.deepEqual(result, { kind: 'unauthorized', deleted: 1, total: 2 });
});
