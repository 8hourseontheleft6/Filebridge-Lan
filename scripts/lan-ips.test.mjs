import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { selectLanIps, isVirtualAdapter } from '../server/lan-ips.mjs';

const FIXTURE = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, 'fixtures', 'lan-ips.json'), 'utf8'),
);

function adapters(rows) {
  return rows.map((row) => ({
    name: row.name,
    description: row.description || '',
    mac: row.mac || '',
    ip: row.ip,
    internal: false,
    up: row.up !== false,
    isDefaultRoute: Boolean(row.isDefaultRoute),
    metric: row.metric ?? 0,
  }));
}

test('shared fixture order matches the Rust implementation', () => {
  const selected = selectLanIps(adapters(FIXTURE.adapters)).map((entry) => entry.ip);
  assert.deepEqual(selected, FIXTURE.expected);
});

test('VirtualBox host-only adapters are excluded by description or MAC', () => {
  const byDescription = { name: '以太网 4', description: 'VirtualBox Host-Only Ethernet Adapter', mac: 'aa:bb:cc:dd:ee:01' };
  const byMac = { name: '以太网 2', description: '', mac: '0a:00:27:00:00:02' };
  assert.equal(isVirtualAdapter(byDescription), true);
  assert.equal(isVirtualAdapter(byMac), true);
});

test('two VirtualBox host-only adapters and a Wi-Fi keep only Wi-Fi', () => {
  const selected = selectLanIps(adapters([
    { name: '以太网 4', description: 'VirtualBox Host-Only Ethernet Adapter', ip: '192.168.56.1', mac: '0a:00:27:00:00:01', isDefaultRoute: false, metric: 35 },
    { name: '以太网 2', description: 'VirtualBox Host-Only Ethernet Adapter #2', ip: '192.168.56.2', mac: '0a:00:27:00:00:02', isDefaultRoute: false, metric: 40 },
    { name: 'WLAN', description: 'MediaTek Wi-Fi 6E MT7922', ip: '192.168.2.53', mac: '78:ab:9c:ff:2e:67', isDefaultRoute: true, metric: 30 },
  ]));
  assert.deepEqual(selected.map((entry) => entry.ip), ['192.168.2.53']);
});

test('only virtual adapters produce no candidates', () => {
  const selected = selectLanIps(adapters([
    { name: '以太网 4', description: 'VirtualBox Host-Only Ethernet Adapter', ip: '192.168.56.1', mac: '0a:00:27:00:00:01' },
    { name: '以太网 3', description: 'TAP-Windows Adapter V9', ip: '10.8.0.6', mac: '00:ff:e3:1d:5d:a8' },
  ]));
  assert.deepEqual(selected, []);
});

test('the default-route adapter wins over address string order', () => {
  const selected = selectLanIps(adapters([
    { name: '以太网', description: 'Realtek PCIe GbE Family Controller', ip: '10.0.0.5', mac: '10:b6:76:85:ce:2d', isDefaultRoute: false, metric: 25 },
    { name: 'WLAN', description: 'MediaTek Wi-Fi 6E MT7922', ip: '192.168.2.53', mac: '78:ab:9c:ff:2e:67', isDefaultRoute: true, metric: 30 },
  ]));
  assert.deepEqual(selected.map((entry) => entry.ip), ['192.168.2.53', '10.0.0.5']);
});

test('link-local addresses and internal adapters are never offered', () => {
  const selected = selectLanIps([
    { name: '以太网', description: 'Realtek PCIe GbE Family Controller', ip: '169.254.10.20', mac: '10:b6:76:85:ce:2d' },
    { name: 'Loopback', description: '', ip: '127.0.0.1', mac: '', internal: true },
    { name: 'WLAN', description: 'MediaTek Wi-Fi 6E MT7922', ip: '192.168.2.53', mac: '78:ab:9c:ff:2e:67' },
  ]);
  assert.deepEqual(selected.map((entry) => entry.ip), ['192.168.2.53']);
});
