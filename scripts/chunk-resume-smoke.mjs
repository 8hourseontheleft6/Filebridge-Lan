import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
const DATA = await fs.mkdtemp(path.join(os.tmpdir(), 'filebridge-resume-'));
const hub = spawn(process.execPath, [path.join(ROOT, 'server', 'hub.mjs')], {
  cwd: ROOT,
  env: { ...process.env, FILEBRIDGE_LAN_HUB_PORT: String(PORT), FILEBRIDGE_LAN_HUB_DATA: DATA },
  stdio: ['ignore', 'pipe', 'pipe'],
});
hub.stdout.on('data', () => {});
hub.stderr.on('data', () => {});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function request(pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: pathname, method,
      headers: { ...headers, ...(body ? { 'Content-Length': body.length } : {}) },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, text, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function writePartial(pathname, headers, body, declaredLength) {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: pathname, method: 'POST',
      headers: { ...headers, 'Content-Length': declaredLength },
    }, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', () => resolve());
    req.write(body);
    setTimeout(() => {
      req.destroy();
      resolve();
    }, 120);
  });
}

try {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await request('/api/session');
      if (response.status === 200) break;
    } catch {}
    await sleep(100);
  }
  const session = (await request('/api/session')).json;
  const paired = (await request('/api/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: Buffer.from(JSON.stringify({ code: session.code })),
  })).json;
  const token = paired.token;
  assert.ok(token, 'pairing token');

  const total = 5 * 1024 * 1024;
  const source = crypto.randomBytes(total);
  const expectedSha = crypto.createHash('sha256').update(source).digest('hex');
  const id = crypto.randomUUID();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' };
  const query = `name=resume-test.bin&id=${id}&total=${total}`;

  const first = await request(`/api/upload/chunk?${query}&offset=0`, {
    method: 'POST', headers, body: source.subarray(0, 2 * 1024 * 1024),
  });
  assert.equal(first.status, 200);
  assert.equal(first.json.offset, 2 * 1024 * 1024);
  assert.equal(first.json.complete, false);

  await writePartial(
    `/api/upload/chunk?${query}&offset=${2 * 1024 * 1024}`,
    headers,
    source.subarray(2 * 1024 * 1024, 3 * 1024 * 1024),
    2 * 1024 * 1024,
  );
  await sleep(300);

  const status = await request(`/api/upload/chunk/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(status.status, 200);
  assert.equal(status.json.complete, false);
  assert.ok(status.json.offset >= 2 * 1024 * 1024, 'server offset after abort');
  assert.ok(status.json.offset < 4 * 1024 * 1024, 'partial chunk did not complete the file');
  const serverOffset = status.json.offset;

  const wrong = await request(`/api/upload/chunk?${query}&offset=${serverOffset - 1}`, {
    method: 'POST', headers, body: Buffer.alloc(0),
  });
  assert.equal(wrong.status, 409);
  assert.equal(wrong.json.offset, serverOffset);

  const rest = await request(`/api/upload/chunk?${query}&offset=${serverOffset}`, {
    method: 'POST', headers, body: source.subarray(serverOffset),
  });
  assert.equal(rest.status, 201);
  assert.equal(rest.json.complete, true);
  assert.equal(rest.json.file.size, total);

  const download = await new Promise((resolve, reject) => {
    http.get({
      host: '127.0.0.1', port: PORT, path: `/api/files/${id}`,
      headers: { Authorization: `Bearer ${token}` },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
  assert.equal(download.length, total);
  assert.equal(crypto.createHash('sha256').update(download).digest('hex'), expectedSha);
  console.log(`RESUME_SMOKE_OK serverOffset=${serverOffset} sha256=${expectedSha.slice(0, 12)}`);
} finally {
  hub.kill();
  await fs.rm(DATA, { recursive: true, force: true }).catch(() => {});
}
