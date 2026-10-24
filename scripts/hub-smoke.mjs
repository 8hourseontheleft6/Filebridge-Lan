/**
 * Filebridge-Lan HTTP Hub 冒烟测试
 *
 * 覆盖：info、上传、SHA-256、下载、Range、空文件、文件名清洗、删除、CORS。
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

function upload(port, name, buffer) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: `/api/upload?name=${encodeURIComponent(name)}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': buffer.length,
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

async function main() {
  const port = await getFreePort();
  const dataDir = path.join(os.tmpdir(), `filebridge-lan-hub-smoke-${process.pid}-${Date.now()}`);

  const child = spawn(process.execPath, [HUB], {
    cwd: ROOT,
    env: {
      ...process.env,
      FILEBRIDGE_LAN_HUB_PORT: String(port),
      FILEBRIDGE_LAN_HUB_DATA: dataDir,
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

    // 2 MB 随机文件
    const payload = crypto.randomBytes(2 * 1024 * 1024);
    const expectedHash = crypto.createHash('sha256').update(payload).digest('hex');
    const uploaded = await upload(port, '冒烟 测试.bin', payload);
    assert.equal(uploaded.size, payload.length);
    assert.equal(uploaded.sha256, expectedHash);
    assert.equal(uploaded.name, '冒烟 测试.bin');
    console.log('PASS upload + sha256');

    const downloaded = await fetch(`http://127.0.0.1:${port}/api/files/${uploaded.id}`);
    assert.equal(downloaded.status, 200);
    const body = Buffer.from(await downloaded.arrayBuffer());
    assert.equal(body.length, payload.length);
    assert.equal(crypto.createHash('sha256').update(body).digest('hex'), expectedHash);
    console.log('PASS download + sha256');

    const range = await fetch(`http://127.0.0.1:${port}/api/files/${uploaded.id}`, {
      headers: { Range: 'bytes=0-1023' },
    });
    assert.equal(range.status, 206);
    const rangeBody = Buffer.from(await range.arrayBuffer());
    assert.equal(rangeBody.length, 1024);
    assert.equal(range.headers.get('content-range'), `bytes 0-1023/${payload.length}`);
    console.log('PASS range');

    const suffix = await fetch(`http://127.0.0.1:${port}/api/files/${uploaded.id}`, {
      headers: { Range: 'bytes=-1024' },
    });
    assert.equal(suffix.status, 206);
    assert.equal((await suffix.arrayBuffer()).byteLength, 1024);
    assert.equal(
      suffix.headers.get('content-range'),
      `bytes ${payload.length - 1024}-${payload.length - 1}/${payload.length}`
    );
    console.log('PASS suffix range');

    const invalidRange = await fetch(`http://127.0.0.1:${port}/api/files/${uploaded.id}`, {
      headers: { Range: `bytes=${payload.length + 10}-` },
    });
    assert.equal(invalidRange.status, 416);
    console.log('PASS invalid range 416');

    const empty = await upload(port, 'empty.bin', Buffer.alloc(0));
    assert.equal(empty.size, 0);
    assert.equal(empty.sha256, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    console.log('PASS empty file');

    const sanitized = await upload(port, '../../evil.txt', Buffer.from('x'));
    assert.equal(sanitized.name, 'evil.txt');
    console.log('PASS filename sanitize');

    const emoji = await upload(port, '🚀 文件.bin', Buffer.from('emoji'));
    assert.equal(emoji.name, '🚀 文件.bin');
    console.log('PASS emoji filename');

    const cors = await fetch(`http://127.0.0.1:${port}/api/upload`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://192.168.1.2:5173' },
    });
    assert.equal(cors.status, 204);
    assert.equal(cors.headers.get('access-control-allow-origin'), '*');
    console.log('PASS cors');

    const del = await fetch(`http://127.0.0.1:${port}/api/files/${uploaded.id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);
    const missing = await fetch(`http://127.0.0.1:${port}/api/files/${uploaded.id}`);
    assert.equal(missing.status, 404);
    console.log('PASS delete + 404');

    console.log('HUB_SMOKE_OK');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(resolve, 2000).unref();
    });
    await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {});
    if (output.trim()) {
      // 只在失败时输出，避免成功时刷屏
      if (process.exitCode) console.error(output);
    }
  }
}

main().catch((error) => {
  console.error('HUB_SMOKE_FAILED:', error);
  process.exit(1);
});
