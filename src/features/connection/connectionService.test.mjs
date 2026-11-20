import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { getConnectStatus } from '../../api/connectionApi.ts';
import {
  PENDING_KEY,
  clearPendingRequest,
  connectOutcome,
  connectStatusError,
  createNearbyService,
  deviceDisplayName,
  isHostCandidate,
  nearbyErrorSnapshot,
  nearbyServiceError,
  nearbySnapshot,
  readPendingRequest,
  remainingSeconds,
  savePendingRequest,
} from './connectionService.ts';

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

const REQUEST = { requestId: 'req-1', requestSecret: 's3cr3t', expiresAt: Date.now() + 60_000 };

test('nearby snapshot maps the discovery status to the scanning flag', () => {
  const peers = [{ id: 'p', name: 'PC', ip: '192.168.2.9', port: 42080, version: '1.6.1', url: 'http://192.168.2.9:42080/' }];
  const starting = nearbySnapshot(peers, { status: 'starting', bound: false, sendTargets: [], peerCount: 0 });
  assert.equal(starting.scanning, true);
  assert.equal(starting.peers.length, 1);
  assert.equal(starting.error, '');

  const listening = nearbySnapshot(peers, { status: 'listening', bound: true, sendTargets: [], peerCount: 1 });
  assert.equal(listening.scanning, false);
});

test('nearby errors clear peers and scanning', () => {
  const failed = nearbyErrorSnapshot(new Error('boom'));
  assert.equal(failed.error, 'boom');
  assert.equal(failed.scanning, false);
  assert.deepEqual(failed.peers, []);
});

test('service error copy distinguishes a broken discovery service from a generic failure', () => {
  const broken = nearbyServiceError({
    peers: [],
    scanning: false,
    error: '',
    discovery: { status: 'error', bound: false, sendTargets: [], peerCount: 0, currentError: '端口被占用' },
  });
  assert.equal(broken, '端口被占用');

  const generic = nearbyServiceError({ peers: [], scanning: false, error: 'rpc failed', discovery: null });
  assert.equal(generic, '发现服务不可用');

  const none = nearbyServiceError({ peers: [], scanning: false, error: '', discovery: null });
  assert.equal(none, '');
});

test('nearby service fetches peers and status through the network port', async () => {
  const calls = [];
  const api = {
    listPeers: async () => {
      calls.push('peers');
      return [];
    },
    getDiscoveryStatus: async () => {
      calls.push('status');
      return { status: 'listening', bound: true, sendTargets: [], peerCount: 0 };
    },
  };
  const service = createNearbyService(api);
  const snapshot = await service.fetch();
  assert.equal(snapshot.scanning, false);
  assert.deepEqual(calls.sort(), ['peers', 'status']);
});

test('host approval gate runs on desktop or loopback pages only', () => {
  assert.equal(isHostCandidate(true, '192.168.2.5'), true);
  assert.equal(isHostCandidate(false, 'localhost'), true);
  assert.equal(isHostCandidate(false, '127.0.0.1'), true);
  assert.equal(isHostCandidate(false, '192.168.2.5'), false);
});

test('device display name comes from the user agent', () => {
  assert.equal(deviceDisplayName('Mozilla/5.0 (Windows NT 10.0)'), 'Windows 电脑');
  assert.equal(deviceDisplayName('Mozilla/5.0 (iPhone)'), 'iPhone / iPad');
  assert.equal(deviceDisplayName('Mozilla/5.0 (Linux)'), 'Linux 电脑');
  assert.equal(deviceDisplayName(''), '另一台电脑');
});

test('pending request round-trips through storage and expires', () => {
  const storage = memoryStorage();
  savePendingRequest(storage, REQUEST);
  assert.deepEqual(readPendingRequest(storage), REQUEST);
  assert.ok(storage.map.has(PENDING_KEY));

  // Expired entries are dropped on read.
  const expired = memoryStorage();
  expired.setItem(PENDING_KEY, JSON.stringify({ ...REQUEST, expiresAt: Date.now() - 1 }));
  assert.equal(readPendingRequest(expired), null);
  assert.equal(expired.map.has(PENDING_KEY), false);

  clearPendingRequest(storage);
  assert.equal(readPendingRequest(storage), null);
});

test('malformed pending storage is ignored', () => {
  const storage = memoryStorage();
  storage.setItem(PENDING_KEY, 'not-json');
  assert.equal(readPendingRequest(storage), null);
  storage.setItem(PENDING_KEY, JSON.stringify({ requestId: 'x' }));
  assert.equal(readPendingRequest(storage), null);
});

test('countdown rounds up and never goes negative', () => {
  const now = 1_000_000;
  assert.equal(remainingSeconds(now + 60_000, now), 60);
  assert.equal(remainingSeconds(now + 500, now), 1);
  assert.equal(remainingSeconds(now - 5_000, now), 0);
});

test('connect outcomes cover pending, approved, denied and expired', () => {
  assert.deepEqual(connectOutcome({ status: 'pending' }), { phase: 'waiting', clearPending: false });
  const approved = connectOutcome({ status: 'approved', token: 'tok', expiresAt: 123 });
  assert.equal(approved.phase, 'idle');
  assert.equal(approved.token, 'tok');
  assert.equal(approved.clearPending, true);
  assert.equal(connectOutcome({ status: 'denied' }).phase, 'denied');
  assert.match(connectOutcome({ status: 'denied' }).error || '', /拒绝/);
  assert.equal(connectOutcome({ status: 'expired' }).phase, 'expired');
  // approved without a token must not be treated as connected
  assert.equal(connectOutcome({ status: 'approved' }).phase, 'waiting');
});

test('status query failures map to error phase and drop stale requests', () => {
  assert.deepEqual(connectStatusError(new Error('连接请求不存在或已失效')), {
    message: '连接请求不存在或已失效',
    clearPending: true,
  });
  assert.deepEqual(connectStatusError('oops'), { message: '查询连接状态失败', clearPending: false });
  assert.equal(connectStatusError(new Error('网络错误')).clearPending, false);
});

test('requestSecret never appears in the status URL or logs', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const logged = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers });
    return new Response(JSON.stringify({ status: 'pending' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  console.log = (...args) => logged.push(args.join(' '));
  console.error = (...args) => logged.push(args.join(' '));
  try {
    await getConnectStatus({ requestId: 'req-42', requestSecret: 'top-secret-value' });
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
  }

  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.includes('/api/connect/requests/req-42'));
  assert.equal(calls[0].url.includes('top-secret-value'), false);
  const headers = calls[0].headers;
  const secretHeader = typeof headers?.get === 'function'
    ? headers.get('X-Connect-Secret')
    : headers?.['X-Connect-Secret'];
  assert.equal(secretHeader, 'top-secret-value');
  assert.equal(logged.join(' ').includes('top-secret-value'), false);
});

test('no source file prints connect secrets to the console', () => {
  const root = path.resolve(import.meta.dirname, '..', '..', '..', 'src');
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
  };
  walk(root);
  const offenders = files.filter((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return /console\.(log|warn|error|info|debug)\s*\([^)]*(requestSecret|token)/.test(text);
  });
  assert.deepEqual(offenders, []);
});
