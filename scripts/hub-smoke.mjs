/**
 * Filebridge-Lan HTTP Hub 冒烟测试
 *
 * 覆盖：Host/Origin 白名单、配对 token、鉴权、上传、SHA-256、下载、Range、
 * 空文件、文件名清洗、CORS、删除、轮换、配对限流。
 * 用法：node scripts/hub-smoke.mjs
 */

import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HUB = path.join(ROOT, 'server', 'hub.mjs');

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

function upload(port, name, buffer, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: `/api/upload?name=${encodeURIComponent(name)}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': buffer.length,
        Authorization: `Bearer ${token}`,
      },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else reject(new Error(`upload ${res.statusCode}: ${body}`));
        } catch (error) {
          reject(new Error(`upload invalid JSON (${res.statusCode}): ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.end(buffer);
  });
}

function rawRequest(port, pathname, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers,
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitForHub(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/info`);
      if (response.ok) return await response.json();
    } catch {
      // retry
    }
    await sleep(200);
  }
  throw new Error('hub did not become ready');
}

async function pair(port, code, origin) {
  return fetch(`http://127.0.0.1:${port}/api/pair`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify({ code }),
  });
}

async function createConnect(port, name = '测试电脑') {
  const response = await fetch(`http://127.0.0.1:${port}/api/connect/requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://tauri.localhost',
    },
    body: JSON.stringify({ name }),
  });
  return { response, body: response.ok ? await response.json() : null };
}

async function connectStatus(port, id, secret) {
  const response = await fetch(`http://127.0.0.1:${port}/api/connect/requests/${id}`, {
    headers: { 'X-Connect-Secret': secret, Origin: 'http://tauri.localhost' },
  });
  return { response, body: response.ok ? await response.json() : null };
}

async function decideConnect(port, id, approve) {
  return fetch(`http://127.0.0.1:${port}/api/connect/requests/${id}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approve }),
  });
}

async function listConnect(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/connect/requests`);
  return { response, body: response.ok ? await response.json() : null };
}

async function main() {
  const port = await getFreePort();
  const dataDir = path.join(os.tmpdir(), `filebridge-lan-hub-smoke-${process.pid}-${Date.now()}`);

  const child = spawn(process.execPath, [HUB], {
    cwd: ROOT,
    env: {
      ...process.env,
      FILEBRIDGE_LAN_HUB_PORT: String(port),
      FILEBRIDGE_LAN_HUB_DATA: dataDir,
      FILEBRIDGE_CONNECT_TTL_MS: '800',
      FILEBRIDGE_CONNECT_MAX_PENDING: '3',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  try {
    const info = await waitForHub(port);
    assert.equal(info.port, port);
    assert.ok(Array.isArray(info.ips));
    console.log(`PASS info (port ${port})`);

    const localIp = info.ips.find((ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip));
    assert.ok(localIp, 'expected a LAN IPv4');
    const lanOrigin = `http://${localIp}:${port}`;

    // Host/Origin 防护
    const normalSession = await fetch(`http://127.0.0.1:${port}/api/session`, {
      headers: { Origin: 'http://tauri.localhost' },
    });
    assert.equal(normalSession.status, 200);
    const session = await normalSession.json();
    assert.match(session.code, /^\d{6}$/);
    const code = session.code;
    console.log(`PASS desktop session (${code})`);

    const evilOrigin = await fetch(`http://127.0.0.1:${port}/api/session`, {
      headers: { Origin: 'http://evil.example' },
    });
    assert.equal(evilOrigin.status, 403);
    const nullOrigin = await fetch(`http://127.0.0.1:${port}/api/session`, {
      headers: { Origin: 'null' },
    });
    assert.equal(nullOrigin.status, 403);
    const evilHost = await rawRequest(port, '/api/session', { Host: 'evil.example:42080' });
    assert.equal(evilHost, 403);
    console.log('PASS Origin/Host rejection');

    const lanSession = await fetch(`${lanOrigin}/api/session`);
    assert.equal(lanSession.status, 403);
    console.log('PASS session loopback-only');

    // 配对
    const wrongPair = await pair(port, '000000', 'http://tauri.localhost');
    assert.equal(wrongPair.status, 401);
    const desktopPair = await pair(port, code, 'http://tauri.localhost');
    assert.equal(desktopPair.status, 200);
    const desktop = await desktopPair.json();
    assert.match(desktop.token, /^[A-Za-z0-9_-]{40,}$/);
    assert.ok(desktop.expiresAt > Date.now());
    const phonePair = await fetch(`${lanOrigin}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: lanOrigin },
      body: JSON.stringify({ code }),
    });
    assert.equal(phonePair.status, 200);
    const phone = await phonePair.json();
    assert.notEqual(phone.token, desktop.token);
    console.log('PASS pairing tokens');

    const noToken = await fetch(`http://127.0.0.1:${port}/api/files`);
    assert.equal(noToken.status, 401);
    const wrongToken = await fetch(`http://127.0.0.1:${port}/api/files`, {
      headers: { Authorization: 'Bearer wrong' },
    });
    assert.equal(wrongToken.status, 401);
    const filesAuth = { Authorization: `Bearer ${desktop.token}` };
    const list = await fetch(`http://127.0.0.1:${port}/api/files`, { headers: filesAuth });
    assert.equal(list.status, 200);
    console.log('PASS token rejection/acceptance');

    // 连接请求：创建、主机查看、错误 secret、批准、重复批准
    const connectCreated = await createConnect(port, 'DESKTOP-GUEST');
    assert.equal(connectCreated.response.status, 201);
    const connectRequest = connectCreated.body;
    assert.match(connectRequest.requestId, /^[0-9a-f-]{36}$/i);
    assert.ok(connectRequest.requestSecret.length >= 40);
    assert.ok(connectRequest.expiresAt > Date.now());

    const pending = await listConnect(port);
    assert.equal(pending.response.status, 200);
    const pendingItem = pending.body.requests.find((item) => item.id === connectRequest.requestId);
    assert.equal(pendingItem.name, 'DESKTOP-GUEST');
    assert.equal(pendingItem.ip, '127.0.0.1');
    assert.equal(pendingItem.secret, undefined);
    assert.equal(pendingItem.requestSecret, undefined);

    const wrongSecret = await connectStatus(port, connectRequest.requestId, 'wrong-secret');
    assert.equal(wrongSecret.response.status, 404);
    const waiting = await connectStatus(port, connectRequest.requestId, connectRequest.requestSecret);
    assert.equal(waiting.body.status, 'pending');

    const approve = await decideConnect(port, connectRequest.requestId, true);
    assert.equal(approve.status, 200);
    const repeatApprove = await decideConnect(port, connectRequest.requestId, true);
    assert.equal(repeatApprove.status, 409);
    const approved = await connectStatus(port, connectRequest.requestId, connectRequest.requestSecret);
    assert.equal(approved.body.status, 'approved');
    assert.ok(approved.body.token);
    const connectTokenList = await fetch(`http://127.0.0.1:${port}/api/files`, {
      headers: { Authorization: `Bearer ${approved.body.token}` },
    });
    assert.equal(connectTokenList.status, 200);
    assert.ok(!output.includes(connectRequest.requestSecret));
    assert.ok(!output.includes(approved.body.token));
    console.log('PASS connect request approve lifecycle');

    const deniedCreated = await createConnect(port, 'DENIED-DESKTOP');
    const denied = await decideConnect(port, deniedCreated.body.requestId, false);
    assert.equal(denied.status, 200);
    const deniedStatus = await connectStatus(
      port,
      deniedCreated.body.requestId,
      deniedCreated.body.requestSecret
    );
    assert.equal(deniedStatus.body.status, 'denied');
    assert.equal(deniedStatus.body.token, undefined);
    assert.equal((await decideConnect(port, deniedCreated.body.requestId, true)).status, 409);
    console.log('PASS connect request denial');

    const expiring = await createConnect(port, 'EXPIRED-DESKTOP');
    await sleep(950);
    const expiredStatus = await connectStatus(port, expiring.body.requestId, expiring.body.requestSecret);
    assert.equal(expiredStatus.body.status, 'expired');
    assert.equal((await decideConnect(port, expiring.body.requestId, true)).status, 410);
    console.log('PASS connect request expiry');

    const capRequests = [];
    for (let index = 0; index < 3; index += 1) {
      const item = await createConnect(port, `PENDING-${index}`);
      assert.equal(item.response.status, 201);
      capRequests.push(item.body);
    }
    const overCap = await createConnect(port, 'OVER-CAP');
    assert.equal(overCap.response.status, 429);
    for (const item of capRequests) {
      assert.equal((await decideConnect(port, item.requestId, false)).status, 200);
    }
    console.log('PASS connect pending cap');

    const rateStatuses = [];
    for (let index = 0; index < 8; index += 1) {
      const item = await createConnect(port, `RATE-${index}`);
      rateStatuses.push(item.response.status);
      if (item.body) await decideConnect(port, item.body.requestId, false);
    }
    assert.ok(rateStatuses.includes(201));
    assert.equal(rateStatuses.at(-1), 429);
    console.log('PASS connect rate limit');

    // 2 MB 随机文件
    const payload = crypto.randomBytes(2 * 1024 * 1024);
    const expectedHash = crypto.createHash('sha256').update(payload).digest('hex');
    const uploaded = await upload(port, '冒烟 测试.bin', payload, desktop.token);
    assert.equal(uploaded.size, payload.length);
    assert.equal(uploaded.sha256, expectedHash);
    assert.equal(uploaded.name, '冒烟 测试.bin');
    console.log('PASS upload + sha256');

    const downloaded = await fetch(`http://127.0.0.1:${port}/api/files/${uploaded.id}`, {
      headers: filesAuth,
    });
    assert.equal(downloaded.status, 200);
    const body = Buffer.from(await downloaded.arrayBuffer());
    assert.equal(body.length, payload.length);
    assert.equal(crypto.createHash('sha256').update(body).digest('hex'), expectedHash);
    console.log('PASS download + sha256');

    const range = await fetch(`http://127.0.0.1:${port}/api/files/${uploaded.id}`, {
      headers: { ...filesAuth, Range: 'bytes=0-1023' },
    });
    assert.equal(range.status, 206);
    const rangeBody = Buffer.from(await range.arrayBuffer());
    assert.equal(rangeBody.length, 1024);
    assert.equal(range.headers.get('content-range'), `bytes 0-1023/${payload.length}`);
    console.log('PASS range');

    const suffix = await fetch(`http://127.0.0.1:${port}/api/files/${uploaded.id}`, {
      headers: { ...filesAuth, Range: 'bytes=-1024' },
    });
    assert.equal(suffix.status, 206);
    assert.equal((await suffix.arrayBuffer()).byteLength, 1024);
    console.log('PASS suffix range');

    const invalidRange = await fetch(`http://127.0.0.1:${port}/api/files/${uploaded.id}`, {
      headers: { ...filesAuth, Range: `bytes=${payload.length + 10}-` },
    });
    assert.equal(invalidRange.status, 416);
    console.log('PASS invalid range 416');

    const queryDownload = await fetch(
      `http://127.0.0.1:${port}/api/files/${uploaded.id}?token=${encodeURIComponent(desktop.token)}`
    );
    assert.equal(queryDownload.status, 200);
    assert.equal((await queryDownload.arrayBuffer()).byteLength, payload.length);
    console.log('PASS query token download');

    const empty = await upload(port, 'empty.bin', Buffer.alloc(0), desktop.token);
    assert.equal(empty.size, 0);
    assert.equal(empty.sha256, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    const sanitized = await upload(port, '../../evil.txt', Buffer.from('x'), desktop.token);
    assert.equal(sanitized.name, 'evil.txt');
    const emoji = await upload(port, '🚀 文件.bin', Buffer.from('emoji'), desktop.token);
    assert.equal(emoji.name, '🚀 文件.bin');
    console.log('PASS empty/sanitize/emoji');

    const cors = await fetch(`http://127.0.0.1:${port}/api/upload`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://tauri.localhost', 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(cors.status, 204);
    assert.equal(cors.headers.get('access-control-allow-origin'), 'http://tauri.localhost');
    assert.notEqual(cors.headers.get('access-control-allow-origin'), '*');
    const evilCors = await fetch(`http://127.0.0.1:${port}/api/upload`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://evil.example' },
    });
    assert.equal(evilCors.status, 403);
    console.log('PASS strict CORS');

    const del = await fetch(`http://127.0.0.1:${port}/api/files/${uploaded.id}`, {
      method: 'DELETE',
      headers: filesAuth,
    });
    assert.equal(del.status, 204);
    const missing = await fetch(`http://127.0.0.1:${port}/api/files/${uploaded.id}`, {
      headers: filesAuth,
    });
    assert.equal(missing.status, 404);
    console.log('PASS delete + 404');

    // 轮换会话码会清空所有 token
    const rotate = await fetch(`http://127.0.0.1:${port}/api/session/rotate`, {
      method: 'POST',
    });
    assert.equal(rotate.status, 200);
    const rotated = await rotate.json();
    assert.match(rotated.code, /^\d{6}$/);
    const oldToken = await fetch(`http://127.0.0.1:${port}/api/files`, { headers: filesAuth });
    assert.equal(oldToken.status, 401);
    console.log('PASS rotation invalidates tokens');

    // 配对失败限流
    const statuses = [];
    for (let index = 0; index < 11; index += 1) {
      const response = await pair(port, '000000', 'http://tauri.localhost');
      statuses.push(response.status);
    }
    assert.ok(statuses.includes(401));
    assert.equal(statuses.at(-1), 429);
    console.log('PASS pairing rate limit');

    console.log('HUB_SMOKE_OK');
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(resolve, 2000).unref();
    });
    await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error('HUB_SMOKE_FAILED:', error);
  process.exit(1);
});
