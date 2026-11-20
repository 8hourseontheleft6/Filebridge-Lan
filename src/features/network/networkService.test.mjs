import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GATE_POLL_MS,
  createNetworkGateService,
  gateSignature,
  isGateBlocked,
  shouldPollGate,
} from './networkService.ts';

const ALLOWED = {
  checked: true,
  compliant: true,
  networks: [{ name: 'WLAN', category: 'private', label: '专用网络' }],
  error: null,
};

const BLOCKED_PUBLIC = {
  checked: true,
  compliant: false,
  networks: [{ name: 'WLAN', category: 'public', label: '公用网络' }],
  error: '检测到非专用网络：WLAN',
};

const BLOCKED_NO_NETWORK = {
  checked: true,
  compliant: false,
  networks: [],
  error: '只检测到虚拟网卡，已暂停局域网服务；请连接真实 Wi-Fi 或以太网',
};

function fakeApi(overrides = {}) {
  return {
    getProfileStatus: async () => ALLOWED,
    refreshLanService: async () => ({ running: true, gate: 'allowed', detail: null, port: 42080 }),
    getLanServiceStatus: async () => ({ running: true, gate: 'allowed', detail: null, port: 42080 }),
    listPeers: async () => [],
    getDiscoveryStatus: async () => ({ status: 'listening', bound: true, sendTargets: [], peerCount: 0 }),
    ...overrides,
  };
}

test('poll interval is still 5 seconds', () => {
  assert.equal(GATE_POLL_MS, 5000);
});

test('only the desktop shell polls the network gate', () => {
  assert.equal(shouldPollGate(true), true);
  assert.equal(shouldPollGate(false), false);
});

test('allowed / public / no-usable-network verdicts', async () => {
  assert.equal(isGateBlocked(ALLOWED), false);
  assert.equal(isGateBlocked(BLOCKED_PUBLIC), true);
  assert.equal(isGateBlocked(BLOCKED_NO_NETWORK), true);
  assert.equal(isGateBlocked(null), false);
});

test('signature stays stable for the same state and changes with the state', () => {
  assert.equal(gateSignature(ALLOWED), gateSignature({ ...ALLOWED }));
  assert.notEqual(gateSignature(ALLOWED), gateSignature(BLOCKED_PUBLIC));
  // A changed error message (e.g. virtual-only vs public) re-shows the warning.
  assert.notEqual(gateSignature(BLOCKED_PUBLIC), gateSignature(BLOCKED_NO_NETWORK));
  // A changed network list also re-shows it.
  assert.notEqual(
    gateSignature(BLOCKED_PUBLIC),
    gateSignature({ ...BLOCKED_PUBLIC, networks: [...BLOCKED_PUBLIC.networks, { name: 'eth', category: 'public', label: '公用网络' }] }),
  );
});

test('check returns the profile status and its signature', async () => {
  const service = createNetworkGateService(fakeApi());
  const snapshot = await service.check();
  assert.equal(snapshot.status.compliant, true);
  assert.equal(snapshot.signature, gateSignature(ALLOWED));
});

test('check failure becomes an unchecked, non-compliant status', async () => {
  const service = createNetworkGateService(fakeApi({
    getProfileStatus: async () => {
      throw new Error('COM unavailable');
    },
  }));
  const snapshot = await service.check();
  assert.equal(snapshot.status.checked, false);
  assert.equal(snapshot.status.compliant, false);
  assert.equal(snapshot.status.error, 'COM unavailable');
  assert.equal(isGateBlocked(snapshot.status), true);
});

test('lan service refresh failures are swallowed to null', async () => {
  const service = createNetworkGateService(fakeApi({
    refreshLanService: async () => {
      throw new Error('no hub');
    },
  }));
  assert.equal(await service.refreshLanService(), null);

  const ok = createNetworkGateService(fakeApi());
  const status = await ok.refreshLanService();
  assert.equal(status?.gate, 'allowed');
});
