import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../../api/errors.ts';
import {
  canToggleFromThisDevice,
  createClipboardService,
  mapClipboardFailure,
  shouldAutoEnable,
  validateOutgoingText,
} from './clipboardService.ts';

const SNAPSHOT = {
  enabled: true,
  text: 'hello',
  hash: 'hash-hello',
  updatedAt: 1,
  revision: 3,
  source: 'phone',
  maxBytes: 262144,
};

function fakeApi(overrides = {}) {
  const calls = [];
  const api = {
    get: async (token) => {
      calls.push(['get', token]);
      return { ...SNAPSHOT };
    },
    setText: async (token, text) => {
      calls.push(['setText', token, text]);
      return { ...SNAPSHOT, text, hash: 'hash-' + text };
    },
    clear: async (token) => {
      calls.push(['clear', token]);
      return { ...SNAPSHOT, text: null, hash: null };
    },
    setEnabled: async (token, enabled) => {
      calls.push(['setEnabled', token, enabled]);
      return { ...SNAPSHOT, enabled };
    },
    ...overrides,
  };
  return { api, calls };
}

function fakePlatform(overrides = {}) {
  const calls = [];
  const platform = {
    readSystemText: async () => {
      calls.push(['readSystemText']);
      return 'system text';
    },
    writeSystemText: async (text) => {
      calls.push(['writeSystemText', text]);
    },
    ...overrides,
  };
  return { platform, calls };
}

test('validateOutgoingText rejects empty and oversized text without calling the Hub', () => {
  assert.equal(validateOutgoingText('').ok, false);
  assert.equal(validateOutgoingText('x'.repeat(262145)).ok, false);
  assert.equal(validateOutgoingText('x'.repeat(262144)).ok, true);
});

test('sendText never reaches the API for oversized input', async () => {
  const { api, calls } = fakeApi();
  const service = createClipboardService(api, fakePlatform().platform);
  const result = await service.sendText('t', 'x'.repeat(300000));
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.message, /256 KiB/);
  assert.equal(calls.length, 0);
});

test('mapClipboardFailure maps status codes and marks 401/403 as dropping text', () => {
  const auth = mapClipboardFailure(ApiError.http(401));
  assert.equal(auth.dropsText, true);
  assert.match(auth.message, /重新配对/);

  const tooLarge = mapClipboardFailure(ApiError.http(413, { code: 'clipboard_too_large' }));
  assert.equal(tooLarge.dropsText, false);
  assert.match(tooLarge.message, /256 KiB/);

  const rate = mapClipboardFailure(ApiError.http(429, { code: 'clipboard_rate_limited' }));
  assert.match(rate.message, /过于频繁/);

  const hostOnly = mapClipboardFailure(ApiError.http(403, { code: 'clipboard_host_only' }));
  assert.match(hostOnly.message, /电脑端/);
});

test('system pull pushes only new text and returns the snapshot', async () => {
  const { api, calls } = fakeApi();
  const { platform } = fakePlatform({ readSystemText: async () => 'fresh text' });
  const service = createClipboardService(api, platform);

  const pushed = await service.pullSystemText({ token: 't', hubHash: '', lastSystemHash: '' });
  assert.equal(pushed.kind, 'pushed');
  assert.equal(calls[0][0], 'setText');
  assert.equal(calls[0][2], 'fresh text');
});

test('system pull de-duplicates against Hub hash and last system hash (echo loop)', async () => {
  const service = createClipboardService(fakeApi().api, fakePlatform().platform);
  const hash = await service.hash('system text');

  const vsHub = await service.pullSystemText({ token: 't', hubHash: hash, lastSystemHash: '' });
  assert.equal(vsHub.kind, 'skipped');

  const vsSystem = await service.pullSystemText({ token: 't', hubHash: '', lastSystemHash: hash });
  assert.equal(vsSystem.kind, 'skipped');
});

test('oversized system clipboard text is rejected locally', async () => {
  const { api, calls } = fakeApi();
  const { platform } = fakePlatform({ readSystemText: async () => 'x'.repeat(270000) });
  const service = createClipboardService(api, platform);

  const result = await service.pullSystemText({ token: 't', hubHash: '', lastSystemHash: '' });
  assert.equal(result.kind, 'failed');
  assert.match(result.kind === 'failed' ? result.message : '', /256 KiB/);
  assert.equal(calls.length, 0);
});

test('auth failure while pushing drops the text', async () => {
  const { api } = fakeApi({
    setText: async () => {
      throw ApiError.http(401);
    },
  });
  const service = createClipboardService(api, fakePlatform().platform);
  const result = await service.pullSystemText({ token: 't', hubHash: '', lastSystemHash: '' });
  assert.equal(result.kind, 'failed');
  assert.equal(result.kind === 'failed' ? result.dropsText : null, true);
});

test('Hub text is written into the system clipboard only for phone-sourced text', async () => {
  const written = [];
  const service = createClipboardService(fakeApi().api, fakePlatform({
    writeSystemText: async (text) => { written.push(text); },
  }).platform);

  const phone = await service.writeHubText({
    desktop: true,
    paused: false,
    snapshot: { ...SNAPSHOT, source: 'phone', hash: 'other-hash' },
    lastSystemHash: '',
  });
  assert.equal(phone.kind, 'written');
  assert.deepEqual(written, ['hello']);

  const fromDesktop = await service.writeHubText({
    desktop: true,
    paused: false,
    snapshot: { ...SNAPSHOT, source: 'desktop' },
    lastSystemHash: '',
  });
  assert.equal(fromDesktop.kind, 'skipped');

  const paused = await service.writeHubText({
    desktop: true,
    paused: true,
    snapshot: { ...SNAPSHOT, source: 'phone' },
    lastSystemHash: '',
  });
  assert.equal(paused.kind, 'skipped');

  const alreadyWritten = await service.writeHubText({
    desktop: true,
    paused: false,
    snapshot: { ...SNAPSHOT, source: 'phone', hash: 'same-hash' },
    lastSystemHash: 'same-hash',
  });
  assert.equal(alreadyWritten.kind, 'skipped');
});

test('toggle and clear go through the API and surface mapped errors', async () => {
  const { api, calls } = fakeApi();
  const service = createClipboardService(api, fakePlatform().platform);

  const enabled = await service.setEnabled('t', false);
  assert.equal(enabled.ok, true);
  assert.deepEqual(calls[0], ['setEnabled', 't', false]);

  const cleared = await service.clear('t');
  assert.equal(cleared.ok, true);
  assert.deepEqual(calls[1], ['clear', 't']);

  const failing = createClipboardService(fakeApi({
    clear: async () => { throw ApiError.http(403, { code: 'clipboard_host_only' }); },
  }).api, fakePlatform().platform);
  const failed = await failing.clear('t');
  assert.equal(failed.ok, false);
  assert.equal(failed.ok ? false : failed.dropsText, true);
});

test('auto-enable happens once per accepted session and respects the gate', () => {
  assert.equal(shouldAutoEnable({
    desktop: true, canToggle: true, paused: false, snapshot: { ...SNAPSHOT, enabled: false }, alreadyTried: false,
  }), true);
  assert.equal(shouldAutoEnable({
    desktop: true, canToggle: true, paused: false, snapshot: { ...SNAPSHOT, enabled: false }, alreadyTried: true,
  }), false);
  assert.equal(shouldAutoEnable({
    desktop: true, canToggle: true, paused: true, snapshot: { ...SNAPSHOT, enabled: false }, alreadyTried: false,
  }), false);
  assert.equal(shouldAutoEnable({
    desktop: false, canToggle: false, paused: false, snapshot: { ...SNAPSHOT, enabled: false }, alreadyTried: false,
  }), false);
  assert.equal(shouldAutoEnable({
    desktop: true, canToggle: true, paused: false, snapshot: { ...SNAPSHOT, enabled: true }, alreadyTried: false,
  }), false);
});

test('only the host may toggle sync', () => {
  // Node has no window/Tauri shell: a LAN browser host name must not allow it.
  assert.equal(canToggleFromThisDevice('192.168.2.53'), false);
  assert.equal(canToggleFromThisDevice('localhost'), true);
});
