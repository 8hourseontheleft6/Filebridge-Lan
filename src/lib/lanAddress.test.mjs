import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { pickPhoneHost, listPhoneHosts } from './hub.ts';

const FIXTURE = path.resolve(import.meta.dirname, '..', '..', 'scripts', 'fixtures', 'lan-ips.json');

test('uses the Hub-provided private Wi-Fi address', () => {
  assert.equal(pickPhoneHost(['192.168.2.53', '192.168.56.1']), '192.168.2.53');
});

test('a wrong VirtualBox address first cannot win over the real network', () => {
  // Older Hubs returned the VirtualBox host-only adapter first; the UI must not
  // build a QR code for 192.168.56.x when a real candidate is also present.
  assert.equal(pickPhoneHost(['192.168.56.1', '192.168.2.53']), '192.168.2.53');
  assert.equal(pickPhoneHost(['192.168.56.1', '10.0.0.5']), '10.0.0.5');
});

test('skips loopback, link-local, unspecified and broadcast entries', () => {
  assert.equal(pickPhoneHost(['127.0.0.1', '169.254.1.1', '192.168.2.53']), '192.168.2.53');
  assert.equal(pickPhoneHost(['0.0.0.0', '255.255.255.255', '10.0.0.5']), '10.0.0.5');
  assert.equal(pickPhoneHost(['224.0.0.1', '172.20.5.7']), '172.20.5.7');
});

test('ignores non-IPv4 and malformed entries', () => {
  assert.equal(pickPhoneHost(['fe80::1', 'not-an-ip', '192.168.2.53']), '192.168.2.53');
  assert.equal(pickPhoneHost(['300.1.1.1']), '');
});

test('returns nothing when the Hub has no real candidate', () => {
  assert.equal(pickPhoneHost([]), '');
  assert.equal(pickPhoneHost(undefined), '');
  assert.equal(pickPhoneHost(['127.0.0.1', '169.254.10.20']), '');
});

test('uses the shared fixture expectation', () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  assert.equal(pickPhoneHost(fixture.expected), '192.168.2.53');
});

test('alternative addresses keep the Hub order and push VirtualBox last', () => {
  assert.deepEqual(
    listPhoneHosts(['192.168.56.1', '192.168.2.53', '10.0.0.5']),
    ['192.168.2.53', '10.0.0.5', '192.168.56.1'],
  );
  assert.deepEqual(listPhoneHosts(['10.0.0.5', '10.0.0.5']), ['10.0.0.5']);
  assert.deepEqual(listPhoneHosts(['127.0.0.1']), []);
});

test('resolvePhoneBase builds the QR URL from the real Hub address', async () => {
  const { resolvePhoneBase } = await import('./hub.ts');
  globalThis.window = { location: { hostname: 'tauri.localhost', port: '', protocol: 'http:' } };
  const hub = (ips) => ({ name: 'Filebridge-Lan Hub', version: '1.6.1-preview.1', port: 42080, ips, files: 0 });
  try {
    assert.equal(resolvePhoneBase(hub(['192.168.2.53'])), 'http://192.168.2.53:42080');
    // A stale Hub that still lists the VirtualBox address first must not change the QR.
    assert.equal(
      resolvePhoneBase(hub(['192.168.56.1', '192.168.2.53'])),
      'http://192.168.2.53:42080',
    );
    assert.equal(resolvePhoneBase(hub([])), '');
  } finally {
    delete globalThis.window;
  }
});
