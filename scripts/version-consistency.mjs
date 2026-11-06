import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const tauri = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const cargo = fs.readFileSync(path.join(ROOT, 'src-tauri', 'Cargo.toml'), 'utf8');
const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];
const lock = fs.readFileSync(path.join(ROOT, 'src-tauri', 'Cargo.lock'), 'utf8');
const lockVersion = /\[\[package\]\]\r?\nname = "filebridge-lan"\r?\nversion = "([^"]+)"/.exec(lock)?.[1];

assert.equal(tauri.version, pkg.version, 'tauri version');
assert.equal(cargoVersion, pkg.version, 'Cargo.toml version');
assert.equal(lockVersion, pkg.version, 'Cargo.lock package version');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out: ${url}`);
}

const children = [];
const tempDirs = [];
try {
  const hubPort = await freePort();
  const hubData = await fsp.mkdtemp(path.join(os.tmpdir(), 'filebridge-version-hub-'));
  tempDirs.push(hubData);
  const hub = spawn(process.execPath, [path.join(ROOT, 'server', 'hub.mjs')], {
    cwd: ROOT,
    env: { ...process.env, FILEBRIDGE_LAN_HUB_PORT: String(hubPort), FILEBRIDGE_LAN_HUB_DATA: hubData },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(hub);
  hub.stdout.on('data', () => {});
  hub.stderr.on('data', () => {});
  const hubInfo = await (await waitFor(`http://127.0.0.1:${hubPort}/api/info`)).json();
  assert.equal(hubInfo.version, pkg.version, 'Node Hub /api/info version');

  const bridgePort = await freePort();
  const bridgeData = await fsp.mkdtemp(path.join(os.tmpdir(), 'filebridge-version-bridge-'));
  tempDirs.push(bridgeData);
  const bridge = spawn(process.execPath, [path.join(ROOT, 'server', 'bridge.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      BRIDGE_PORT: String(bridgePort),
      BRIDGE_HOST: '127.0.0.1',
      BRIDGE_DATA: bridgeData,
      BRIDGE_PUBLIC_URL: `http://127.0.0.1:${bridgePort}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(bridge);
  bridge.stdout.on('data', () => {});
  bridge.stderr.on('data', () => {});
  const bridgeHealth = await (await waitFor(`http://127.0.0.1:${bridgePort}/api/health`)).json();
  assert.equal(bridgeHealth.version, pkg.version, 'Node Bridge /api/health version');

  console.log(`VERSION_OK ${pkg.version} package/tauri/cargo/lock/node-hub/node-bridge`);
} finally {
  for (const child of children) child.kill();
  for (const dir of tempDirs) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
}
