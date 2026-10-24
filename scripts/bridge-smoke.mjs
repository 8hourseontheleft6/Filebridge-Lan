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
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveClientIp } from '../server/bridge-util.mjs';

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
      BRIDGE_ACCESS_TOKEN: 'test-access-token',
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

    // 可信代理链从右向左解析；不能直接采用可伪造的 XFF 第一项。
    const trusted = new Set(['127.0.0.1']);
    assert.equal(
      resolveClientIp('127.0.0.1', '198.51.100.7, 203.0.113.9', trusted),
      '203.0.113.9'
    );
    assert.equal(
      resolveClientIp('127.0.0.1', '198.51.100.7, 127.0.0.1', trusted),
      '198.51.100.7'
    );
    assert.equal(
      resolveClientIp('127.0.0.1', '198.51.100.7, 127.0.0.1, 127.0.0.1', trusted),
      '198.51.100.7'
    );
    console.log('PASS trusted XFF chain (right-to-left)');

    const createdResponse = await fetch(`http://127.0.0.1:${port}/api/transfers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '../hello\r\n.txt', size: 32, chunkSize: 262144 }),
    });
    assert.equal(createdResponse.status, 401);
    console.log('PASS create access token rejection');

    const createdResponseWithAuth = await fetch(`http://127.0.0.1:${port}/api/transfers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-access-token',
      },
      body: JSON.stringify({ name: '../hello\r\n.txt', size: 32, chunkSize: 262144 }),
    });
    assert.equal(createdResponseWithAuth.status, 201);
    const created = await json(createdResponseWithAuth);
    assert.match(created.id, /^[0-9a-f-]{36}$/i);
    assert.match(created.code, /^[A-Z0-9]{8}$/);
    assert.match(created.downloadToken, /^[A-Za-z0-9_-]{40,}$/);
    assert.equal(created.name, 'hello__.txt');
    assert.equal(created.chunks, 1);
    console.log('PASS create + sanitize');
    assert.ok(!output.includes(created.uploadToken));
    assert.ok(!output.includes(created.downloadToken));
    assert.ok(!output.includes('test-access-token'));
    console.log('PASS access/upload/download tokens not logged');

    const payload = crypto.randomBytes(60);
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

    const noLookupToken = await fetch(`http://127.0.0.1:${port}/api/transfers/code/${created.code}`);
    assert.equal(noLookupToken.status, 401);
    const lookup = await fetch(`http://127.0.0.1:${port}/api/transfers/code/${created.code}`, {
      headers: { 'X-Download-Token': created.downloadToken },
    });
    assert.equal(lookup.status, 200);
    const meta = await json(lookup);
    assert.equal(meta.name, 'hello__.txt');
    assert.equal(meta.uploadToken, undefined);
    assert.equal(meta.downloadToken, undefined);
    console.log('PASS code lookup + download token');

    const noDownloadToken = await fetch(
      `http://127.0.0.1:${port}/api/transfers/${created.id}/chunks/0?code=${created.code}`
    );
    assert.equal(noDownloadToken.status, 401);
    const download = await fetch(
      `http://127.0.0.1:${port}/api/transfers/${created.id}/chunks/0?code=${created.code}&token=${encodeURIComponent(created.downloadToken)}`
    );
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), payload);
    console.log('PASS chunk download');

    const wrongToken = await fetch(
      `http://127.0.0.1:${port}/api/transfers/${created.id}/chunks/0?code=${created.code}&token=wrong`
    );
    assert.equal(wrongToken.status, 401);
    console.log('PASS download token rejection');

    const remove = await fetch(`http://127.0.0.1:${port}/api/transfers/${created.id}`, {
      method: 'DELETE',
      headers: { 'X-Upload-Token': created.uploadToken },
    });
    assert.equal(remove.status, 204);
    const gone = await fetch(`http://127.0.0.1:${port}/api/transfers/code/${created.code}`, {
      headers: { 'X-Download-Token': created.downloadToken },
    });
    assert.equal(gone.status, 404);
    console.log('PASS delete + 404');

    const badCreate = await fetch(`http://127.0.0.1:${port}/api/transfers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-access-token',
      },
      body: JSON.stringify({ name: 'bad-chunk.bin', size: 32, chunkSize: 262144 }),
    });
    assert.equal(badCreate.status, 201);
    const bad = await json(badCreate);
    const badUpload = await fetch(`http://127.0.0.1:${port}/api/transfers/${bad.id}/chunks/0`, {
      method: 'PUT',
      headers: {
        'X-Upload-Token': bad.uploadToken,
        'Content-Type': 'application/octet-stream',
      },
      body: Buffer.from('x'),
    });
    assert.equal(badUpload.status, 204);
    const badComplete = await fetch(`http://127.0.0.1:${port}/api/transfers/${bad.id}/complete`, {
      method: 'POST',
      headers: { 'X-Upload-Token': bad.uploadToken },
    });
    assert.equal(badComplete.status, 409);
    console.log('PASS chunk size validation');

    // 配额必须原子预留：并发创建不能全部通过 usedBytes 检查。
    const quotaPort = await getFreePort();
    const quotaData = path.join(os.tmpdir(), `filebridge-bridge-quota-${process.pid}-${Date.now()}`);
    const quota = spawn(process.execPath, [BRIDGE], {
      cwd: ROOT,
      env: {
        ...process.env,
        BRIDGE_PORT: String(quotaPort),
        BRIDGE_DATA: quotaData,
        BRIDGE_PUBLIC_URL: `http://127.0.0.1:${quotaPort}`,
        BRIDGE_ACCESS_TOKEN: 'test-access-token',
        BRIDGE_MAX_BYTES: String(1024 * 1024),
        BRIDGE_MAX_STORAGE: String(800 * 1024),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForServer(quotaPort);
    const quotaResponses = await Promise.all(Array.from({ length: 10 }, () =>
      fetch(`http://127.0.0.1:${quotaPort}/api/transfers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-access-token',
        },
        body: JSON.stringify({ name: 'quota.bin', size: 600 * 1024, chunkSize: 262144 }),
      })
    ));
    const quotaStatuses = quotaResponses.map((response) => response.status);
    assert.equal(quotaStatuses.filter((status) => status === 201).length, 1);
    assert.equal(quotaStatuses.filter((status) => status === 507).length, 9);
    quota.kill('SIGTERM');
    await fsp.rm(quotaData, { recursive: true, force: true }).catch(() => {});
    console.log('PASS concurrent storage quota reservation');


    const rejectedPort = await getFreePort();
    const rejected = spawn(process.execPath, [BRIDGE], {
      cwd: ROOT,
      env: {
        ...process.env,
        BRIDGE_PORT: String(rejectedPort),
        BRIDGE_DATA: path.join(os.tmpdir(), `filebridge-bridge-reject-${process.pid}-${Date.now()}`),
        BRIDGE_PUBLIC_URL: 'http://relay.example.com',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const rejectedCode = await new Promise((resolve) => {
      rejected.once('exit', (code) => resolve(code));
      setTimeout(() => {
        rejected.kill('SIGTERM');
        resolve(null);
      }, 5000).unref();
    });
    assert.notEqual(rejectedCode, 0);
    console.log('PASS non-loopback HTTP rejected at startup');

    const noAuthPort = await getFreePort();
    const noAuth = spawn(process.execPath, [BRIDGE], {
      cwd: ROOT,
      env: {
        ...process.env,
        BRIDGE_PORT: String(noAuthPort),
        BRIDGE_DATA: path.join(os.tmpdir(), `filebridge-bridge-noauth-${process.pid}-${Date.now()}`),
        BRIDGE_PUBLIC_URL: 'https://relay.example.com',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const noAuthCode = await new Promise((resolve) => {
      noAuth.once('exit', (code) => resolve(code));
      setTimeout(() => {
        noAuth.kill('SIGTERM');
        resolve(null);
      }, 5000).unref();
    });
    assert.notEqual(noAuthCode, 0);
    console.log('PASS public relay requires access token at startup');

    const noProxyPort = await getFreePort();
    const noProxy = spawn(process.execPath, [BRIDGE], {
      cwd: ROOT,
      env: {
        ...process.env,
        BRIDGE_PORT: String(noProxyPort),
        BRIDGE_DATA: path.join(os.tmpdir(), `filebridge-bridge-noproxy-${process.pid}-${Date.now()}`),
        BRIDGE_PUBLIC_URL: 'https://relay.example.com',
        BRIDGE_ACCESS_TOKEN: 'test-access-token',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const noProxyCode = await new Promise((resolve) => {
      noProxy.once('exit', (code) => resolve(code));
      setTimeout(() => {
        noProxy.kill('SIGTERM');
        resolve(null);
      }, 5000).unref();
    });
    assert.notEqual(noProxyCode, 0);
    console.log('PASS public relay requires trusted proxy for HTTPS');

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
