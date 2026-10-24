/**
 * Filebridge-Lan Encrypted Relay 冒烟测试
 *
 * 覆盖：health、创建传输、上传鉴权、分片上传、完成、按码查询、下载、错误码、删除。
 * 用法：node scripts/bridge-smoke.mjs
 */

import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BRIDGE = path.join(ROOT, 'server', 'bridge.mjs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return await response.json();
    } catch {
      // retry
    }
    await sleep(150);
  }
  throw new Error('bridge did not become ready');
}

async function json(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main() {
  const port = await getFreePort();
  const dataDir = path.join(os.tmpdir(), `filebridge-bridge-smoke-${process.pid}-${Date.now()}`);
  const child = spawn(process.execPath, [BRIDGE], {
    cwd: ROOT,
    env: {
      ...process.env,
      BRIDGE_PORT: String(port),
      BRIDGE_DATA: dataDir,
      BRIDGE_PUBLIC_URL: `http://127.0.0.1:${port}`,
      BRIDGE_MAX_BYTES: String(1024 * 1024),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  try {
    const health = await waitForServer(port);
    assert.equal(health.name, 'Filebridge-Lan Bridge');
    console.log('PASS health');

    const createdResponse = await fetch(`http://127.0.0.1:${port}/api/transfers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '../hello\r\n.txt', size: 32, chunkSize: 262144 }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await json(createdResponse);
    assert.match(created.id, /^[0-9a-f-]{36}$/i);
    assert.match(created.code, /^[A-Z0-9]{8}$/);
    assert.equal(created.name, 'hello__.txt');
    assert.equal(created.chunks, 1);
    console.log('PASS create + sanitize');

    const payload = Buffer.from('0123456789abcdef0123456789abcdef');
    const wrongUpload = await fetch(`http://127.0.0.1:${port}/api/transfers/${created.id}/chunks/0`, {
      method: 'PUT',
      headers: { 'X-Upload-Token': 'wrong', 'Content-Type': 'application/octet-stream' },
      body: payload,
    });
    assert.equal(wrongUpload.status, 403);
    console.log('PASS upload token rejection');

    const upload = await fetch(`http://127.0.0.1:${port}/api/transfers/${created.id}/chunks/0`, {
      method: 'PUT',
      headers: { 'X-Upload-Token': created.uploadToken, 'Content-Type': 'application/octet-stream' },
      body: payload,
    });
    assert.equal(upload.status, 204);
    console.log('PASS chunk upload');

    const complete = await fetch(`http://127.0.0.1:${port}/api/transfers/${created.id}/complete`, {
      method: 'POST',
      headers: { 'X-Upload-Token': created.uploadToken },
    });
    assert.equal(complete.status, 200);
    const completed = await json(complete);
    assert.equal(completed.completed, true);
    console.log('PASS complete');

    const lookup = await fetch(`http://127.0.0.1:${port}/api/transfers/code/${created.code}`);
    assert.equal(lookup.status, 200);
    const meta = await json(lookup);
    assert.equal(meta.name, 'hello__.txt');
    assert.equal(meta.uploadToken, undefined);
    console.log('PASS code lookup');

    const download = await fetch(`http://127.0.0.1:${port}/api/transfers/${created.id}/chunks/0?code=${created.code}`);
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), payload);
    console.log('PASS chunk download');

    const wrongCode = await fetch(`http://127.0.0.1:${port}/api/transfers/${created.id}/chunks/0?code=ZZZZZZZZ`);
    assert.equal(wrongCode.status, 403);
    console.log('PASS download code rejection');

    const remove = await fetch(`http://127.0.0.1:${port}/api/transfers/${created.id}`, {
      method: 'DELETE',
      headers: { 'X-Upload-Token': created.uploadToken },
    });
    assert.equal(remove.status, 204);
    const gone = await fetch(`http://127.0.0.1:${port}/api/transfers/code/${created.code}`);
    assert.equal(gone.status, 404);
    console.log('PASS delete + 404');

    console.log('BRIDGE_SMOKE_OK');
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    child.kill('SIGTERM');
    await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
