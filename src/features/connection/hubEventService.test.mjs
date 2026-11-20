import assert from 'node:assert/strict';
import test from 'node:test';

import { parseUploadEvent } from './hubEventService.ts';

test('a valid upload event is parsed as-is', () => {
  const event = {
    id: 'u1',
    name: 'movie.mkv',
    loaded: 4,
    total: 8,
    status: 'progress',
  };
  assert.deepEqual(parseUploadEvent(JSON.stringify(event)), event);
});

test('invalid JSON is ignored', () => {
  assert.equal(parseUploadEvent('{not json'), null);
  assert.equal(parseUploadEvent(''), null);
});

test('an empty JSON object is still returned (fields are checked by the caller)', () => {
  assert.deepEqual(parseUploadEvent('{}'), {});
});
