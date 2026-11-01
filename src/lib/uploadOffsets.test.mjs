import assert from 'node:assert/strict';
import test from 'node:test';
import {
  confirmedPercent,
  hasServerFile,
  resolveServerOffset,
  shouldShowLiveUpload,
} from './uploadOffsets.ts';

const current = { confirmedOffset: 320, inFlightLoaded: 355 };

test('server offset greater than local is authoritative', () => {
  assert.deepEqual(resolveServerOffset(current, { offset: 360, complete: false }), {
    confirmedOffset: 360,
    inFlightLoaded: 360,
  });
});

test('server offset smaller than local is authoritative', () => {
  assert.deepEqual(resolveServerOffset(current, { offset: 300, complete: false }), {
    confirmedOffset: 300,
    inFlightLoaded: 300,
  });
});

test('complete status carries a file and never regresses to in-flight bytes', () => {
  const status = { offset: 400, complete: true, file: { id: 'f1' } };
  assert.equal(hasServerFile(status), true);
  assert.deepEqual(resolveServerOffset(current, status), {
    confirmedOffset: 400,
    inFlightLoaded: 400,
  });
});

test('failed status query retains the last confirmed offset', () => {
  assert.deepEqual(resolveServerOffset(current, null), current);
  assert.deepEqual(resolveServerOffset(current, undefined), current);
});

test('same upload ID is never shown as a receive stream', () => {
  assert.equal(shouldShowLiveUpload('upload-1', 'upload-1'), false);
  assert.equal(shouldShowLiveUpload('upload-1', 'upload-2'), true);
  assert.equal(shouldShowLiveUpload(undefined, 'upload-2'), true);
  assert.equal(shouldShowLiveUpload('upload-1', undefined), false);
});

test('progress uses confirmed bytes, not in-flight bytes', () => {
  assert.equal(confirmedPercent(320, 1000), 32);
  assert.equal(confirmedPercent(355, 1000), 36);
  assert.equal(confirmedPercent(0, 0), 0);
});
