/**
 * Filebridge-Lan - Encrypted Relay Bridge
 *
 * 独立于局域网 Hub 的公网中继：
 * - 发送方在本机加密文件，服务端只保存密文分片
 * - 8 位传输码 + 随机上传令牌
 * - TTL 自动清理、存储配额、简单限流
 * - 同时托管 dist/，手机可通过公网链接直接打开接收页
 *
 * 启动：node server/bridge.mjs
 * 环境变量：
 *   BRIDGE_PORT=43000
 *   BRIDGE_HOST=0.0.0.0
 *   BRIDGE_DATA=./.filebridge-bridge
 *   BRIDGE_DIST=./dist
 *   BRIDGE_PUBLIC_URL=https://relay.example.com
 *   BRIDGE_MAX_BYTES=2147483648
 *   BRIDGE_MAX_STORAGE=8589934592
 *   BRIDGE_TTL_HOURS=24
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { resolveClientIp } from './bridge-util.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const VERSION = '1.5.0';
const PORT = Number(process.env.BRIDGE_PORT || 43000);
const HOST = process.env.BRIDGE_HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.BRIDGE_DATA || path.join(ROOT, '.filebridge-bridge'));
const DIST_DIR = path.resolve(process.env.BRIDGE_DIST || path.join(ROOT, 'dist'));
const PUBLIC_URL = String(process.env.BRIDGE_PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const MAX_BYTES = Number(process.env.BRIDGE_MAX_BYTES || 2 * 1024 * 1024 * 1024);
const MAX_STORAGE = Number(process.env.BRIDGE_MAX_STORAGE || 8 * 1024 * 1024 * 1024);
const TTL_HOURS = Number(process.env.BRIDGE_TTL_HOURS || 24);
const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;
const MAX_CHUNKS = 4096;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const TRUST_PROXY = process.env.BRIDGE_TRUST_PROXY === '1';
const ALLOW_HTTP = process.env.BRIDGE_ALLOW_HTTP === '1';
const ACCESS_TOKEN = String(process.env.BRIDGE_ACCESS_TOKEN || '').trim();
const ALLOW_ANONYMOUS = process.env.BRIDGE_ALLOW_ANONYMOUS === '1';
const MAX_CONCURRENT = Number(process.env.BRIDGE_MAX_CONCURRENT || 16);
const TRUSTED_PROXIES = new Set(
  String(process.env.BRIDGE_TRUSTED_PROXIES || '127.0.0.1,::1,::ffff:127.0.0.1')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

function isLoopbackAddress(address) {
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1';
}

function publicUrlIsLocal() {
  try {
    const parsed = new URL(PUBLIC_URL);
    return parsed.hostname === 'localhost'
      || parsed.hostname === '127.0.0.1'
      || parsed.hostname === '::1'
      || parsed.hostname === '[::1]';
  } catch {
    return false;
  }
}

if (!PUBLIC_URL.startsWith('https://') && !publicUrlIsLocal() && !ALLOW_HTTP) {
  throw new Error(
    'BRIDGE_PUBLIC_URL 必须使用 HTTPS（非回环地址）；本地开发可显式设置 BRIDGE_ALLOW_HTTP=1'
  );
}

if (!publicUrlIsLocal() && !ACCESS_TOKEN && !ALLOW_ANONYMOUS) {
  throw new Error(
    '非本地中继必须设置 BRIDGE_ACCESS_TOKEN（发送方创建传输的访问令牌）；如明确要匿名公开实例，设置 BRIDGE_ALLOW_ANONYMOUS=1'
  );
}

if (!publicUrlIsLocal() && !TRUST_PROXY && !ALLOW_HTTP) {
  throw new Error(
    '非本地中继必须设置 BRIDGE_TRUST_PROXY=1，并由可信 HTTPS 反向代理发送 X-Forwarded-Proto=https'
  );
}

let activeDownloads = 0;
let activeUploads = 0;

const TRANSFERS_DIR = path.join(DATA_DIR, 'transfers');
const transfers = new Map();
const codeIndex = new Map();
let usedBytes = 0;
let reservedBytes = 0;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function log(...args) {
  console.log('[bridge]', ...args);
}

function transferDir(id) {
  return path.join(TRANSFERS_DIR, id);
}

function metaPath(id) {
  return path.join(transferDir(id), 'meta.json');
}

function chunkPath(id, index) {
  return path.join(transferDir(id), 'chunks', `${index}.bin`);
}

function isId(value) {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
}

function isChunkIndex(value, chunks) {
  return /^\d+$/.test(value) && Number(value) >= 0 && Number(value) < chunks;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function makeCode() {
  let code = '';
  for (let i = 0; i < 8; i += 1) {
    code += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

function sanitizeName(raw) {
  const base = String(raw || 'file').split(/[\\/]/).pop() || 'file';
  const safe = base
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .replace(/^\s+|\s+$/g, '')
    .slice(0, 200);
  return safe || 'file';
}

function publicMeta(meta) {
  return {
    id: meta.id,
    code: meta.code,
    name: meta.name,
    size: meta.size,
    chunkSize: meta.chunkSize,
    chunks: meta.chunks,
    completed: meta.completed,
    createdAt: meta.createdAt,
    expiresAt: meta.expiresAt,
  };
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Upload-Token, X-Transfer-Code');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function sendJson(res, status, data) {
  if (res.writableEnded) return;
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text) {
  if (res.writableEnded) return;
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function sendNoContent(res) {
  if (res.writableEnded) return;
  res.writeHead(204);
  res.end();
}

async function readJson(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function saveMeta(meta) {
  await fsp.mkdir(transferDir(meta.id), { recursive: true });
  const tmp = `${metaPath(meta.id)}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(meta, null, 2));
  await fsp.rename(tmp, metaPath(meta.id));
}

async function removeTransfer(id) {
  const meta = transfers.get(id);
  if (!meta) return false;
  transfers.delete(id);
  codeIndex.delete(meta.code);
  usedBytes = Math.max(0, usedBytes - meta.size);
  await fsp.rm(transferDir(id), { recursive: true, force: true });
  log(`删除传输 ${meta.code} (${meta.name})`);
  return true;
}

async function loadTransfers() {
  await fsp.mkdir(TRANSFERS_DIR, { recursive: true });
  const entries = await fsp.readdir(TRANSFERS_DIR, { withFileTypes: true }).catch(() => []);
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.isDirectory() || !isId(entry.name)) continue;
    try {
      const meta = JSON.parse(await fsp.readFile(metaPath(entry.name), 'utf8'));
      if (!meta?.id || meta.id !== entry.name || !isId(meta.id)) continue;
      if (meta.expiresAt <= now) {
        await fsp.rm(transferDir(meta.id), { recursive: true, force: true });
        continue;
      }
      transfers.set(meta.id, meta);
      codeIndex.set(meta.code, meta.id);
      usedBytes += Number(meta.size) || 0;
    } catch {
      // 忽略损坏的元数据
    }
  }
  log(`已加载 ${transfers.size} 个传输，已占用 ${Math.round(usedBytes / 1024 / 1024)} MB`);
}

async function cleanupExpired() {
  const now = Date.now();
  for (const meta of [...transfers.values()]) {
    if (meta.expiresAt <= now) await removeTransfer(meta.id);
  }
}

function getDownloadToken(req, url) {
  const header = req.headers['x-download-token'];
  return String(url.searchParams.get('token') || header || '').trim();
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

const rateBuckets = new Map();
function rateLimit(ip, bucket, max, windowMs) {
  const key = `${ip}:${bucket}`;
  const now = Date.now();
  let item = rateBuckets.get(key);
  if (!item || item.resetAt <= now) {
    item = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(key, item);
  }
  item.count += 1;
  return item.count <= max;
}

function globalRateLimit(bucket, max, windowMs) {
  return rateLimit('*', bucket, max, windowMs);
}

function isTrustedProxy(req) {
  return TRUST_PROXY && TRUSTED_PROXIES.has(req.socket.remoteAddress || '');
}

function clientIp(req) {
  if (!isTrustedProxy(req)) {
    return req.socket.remoteAddress || 'unknown';
  }
  return resolveClientIp(
    req.socket.remoteAddress || '',
    req.headers['x-forwarded-for'],
    TRUSTED_PROXIES
  );
}

function isSecureRequest(req) {
  if (TRUST_PROXY && isTrustedProxy(req)) {
    const proto = String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    return proto === 'https';
  }
  return isLoopbackAddress(req.socket.remoteAddress || '');
}

function requireDownloadAccess(meta, req, url) {
  const token = getDownloadToken(req, url);
  return Boolean(token) && safeEqual(token, meta.downloadToken || '');
}

function reserveStorage(size) {
  if (usedBytes + reservedBytes + size > MAX_STORAGE) {
    return false;
  }
  reservedBytes += size;
  return true;
}

function releaseReservation(size) {
  reservedBytes = Math.max(0, reservedBytes - size);
}

async function createTransfer(req, res) {
  const ip = clientIp(req);
  if (!rateLimit(ip, 'create', 20, 60_000) || !globalRateLimit('create', 200, 60_000)) {
    return sendJson(res, 429, { error: '创建过于频繁，请稍后再试' });
  }

  if (ACCESS_TOKEN) {
    const authorization = String(req.headers.authorization || '');
    const provided = authorization.startsWith('Bearer ')
      ? authorization.slice(7).trim()
      : '';
    if (!provided || !safeEqual(provided, ACCESS_TOKEN)) {
      return sendJson(res, 401, { error: '未授权' });
    }
  } else if (!isLoopbackAddress(req.socket.remoteAddress || '')) {
    return sendJson(res, 401, { error: '需要中继访问令牌' });
  }

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendJson(res, 400, { error: String(error.message || error) });
  }

  const name = sanitizeName(body.name);
  const size = Number(body.size);
  if (!Number.isSafeInteger(size) || size < 0) {
    return sendJson(res, 400, { error: 'size 不合法' });
  }
  if (size > MAX_BYTES) {
    return sendJson(res, 413, { error: `文件超过上限 ${Math.round(MAX_BYTES / 1024 / 1024)} MB` });
  }
  const chunkSize = Number(body.chunkSize) || DEFAULT_CHUNK_SIZE;
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 256 * 1024 || chunkSize > 8 * 1024 * 1024) {
    return sendJson(res, 400, { error: 'chunkSize 不合法' });
  }
  const chunks = Math.max(1, Math.ceil(size / chunkSize));
  if (chunks > MAX_CHUNKS) {
    return sendJson(res, 413, { error: '分片数量过多' });
  }
  if (!reserveStorage(size)) {
    return sendJson(res, 507, { error: '中继存储空间已满，请稍后再试' });
  }

  const id = crypto.randomUUID();
  let code = makeCode();
  while (codeIndex.has(code)) code = makeCode();
  const uploadToken = randomToken(32);
  const downloadToken = randomToken(32);
  const now = Date.now();
  const meta = {
    id,
    code,
    uploadToken,
    downloadToken,
    name,
    size,
    chunkSize,
    chunks,
    completed: false,
    createdAt: now,
    expiresAt: now + TTL_HOURS * 3600 * 1000,
  };

  try {
    await fsp.mkdir(path.join(transferDir(id), 'chunks'), { recursive: true });
    await saveMeta(meta);
    transfers.set(id, meta);
    codeIndex.set(code, id);
    releaseReservation(size);
    usedBytes += size;
  } catch (error) {
    releaseReservation(size);
    await fsp.rm(transferDir(id), { recursive: true, force: true }).catch(() => {});
    return sendJson(res, 500, { error: '创建传输失败，请稍后重试' });
  }
  log(`创建传输 ${code} ${name} (${size} bytes, ${chunks} chunks)`);

  sendJson(res, 201, {
    id,
    code,
    uploadToken,
    downloadToken,
    name,
    size,
    chunkSize,
    chunks,
    expiresAt: meta.expiresAt,
    publicUrl: PUBLIC_URL,
  });
}

function expectedChunkSize(meta, index) {
  const plain = index < meta.chunks - 1
    ? meta.chunkSize
    : Math.max(0, meta.size - (meta.chunks - 1) * meta.chunkSize);
  // 12-byte IV + AES-GCM tag（16-byte）
  return plain + 28;
}

async function uploadChunk(req, res, id, indexText) {
  const meta = transfers.get(id);
  if (!meta) return sendJson(res, 404, { error: '传输不存在或已过期' });
  if (meta.completed) return sendJson(res, 409, { error: '传输已完成' });
  if (!isChunkIndex(indexText, meta.chunks)) return sendJson(res, 400, { error: '分片序号不合法' });

  const token = req.headers['x-upload-token'] || '';
  if (!safeEqual(token, meta.uploadToken)) {
    return sendJson(res, 403, { error: '上传令牌无效' });
  }

  const ip = clientIp(req);
  if (!rateLimit(ip, 'upload', 120, 60_000) || !globalRateLimit('upload', 2000, 60_000)) {
    return sendJson(res, 429, { error: '上传过于频繁，请稍后再试' });
  }
  if (activeUploads >= MAX_CONCURRENT) {
    return sendJson(res, 503, { error: '中继并发已满，请稍后再试' });
  }

  const max = meta.chunkSize + 64;
  const length = Number(req.headers['content-length'] || 0);
  if (length > max) return sendJson(res, 413, { error: '分片过大' });

  const target = chunkPath(id, Number(indexText));
  const temp = `${target}.${crypto.randomUUID()}.tmp`;
  await fsp.mkdir(path.dirname(target), { recursive: true });

  let received = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > max) {
        callback(new Error('分片过大'));
        return;
      }
      callback(null, chunk);
    },
  });

  activeUploads += 1;
  try {
    await pipeline(req, limiter, fs.createWriteStream(temp, { flags: 'w' }));
    if (received === 0) throw new Error('分片为空');
    await fsp.rename(temp, target);
    sendNoContent(res);
  } catch (error) {
    await fsp.unlink(temp).catch(() => {});
    if (!res.headersSent) sendJson(res, 400, { error: `写入分片失败: ${error.message}` });
  } finally {
    activeUploads -= 1;
  }
}

async function completeTransfer(req, res, id) {
  const meta = transfers.get(id);
  if (!meta) return sendJson(res, 404, { error: '传输不存在或已过期' });

  const token = req.headers['x-upload-token'] || '';
  if (!safeEqual(token, meta.uploadToken)) {
    return sendJson(res, 403, { error: '上传令牌无效' });
  }

  for (let index = 0; index < meta.chunks; index += 1) {
    try {
      const stat = await fsp.stat(chunkPath(id, index));
      if (!stat.isFile() || stat.size !== expectedChunkSize(meta, index)) {
        throw new Error('invalid size');
      }
    } catch {
      return sendJson(res, 409, { error: `分片 ${index} 缺失或大小不符` });
    }
  }

  meta.completed = true;
  meta.completedAt = Date.now();
  await saveMeta(meta);
  transfers.set(id, meta);
  log(`完成传输 ${meta.code} ${meta.name}`);
  sendJson(res, 200, publicMeta(meta));
}

async function getByCode(req, res, code, url) {
  const ip = clientIp(req);
  if (!rateLimit(ip, 'lookup', 60, 60_000) || !globalRateLimit('lookup', 1200, 60_000)) {
    return sendJson(res, 429, { error: '查询过于频繁，请稍后再试' });
  }
  const id = codeIndex.get(code.toUpperCase());
  const meta = id ? transfers.get(id) : null;
  if (!meta || meta.expiresAt <= Date.now()) {
    return sendJson(res, 404, { error: '传输码不存在或已过期' });
  }
  if (!requireDownloadAccess(meta, req, url)) {
    return sendJson(res, 401, { error: '未授权' });
  }
  sendJson(res, 200, publicMeta(meta));
}

async function downloadChunk(req, res, id, indexText, url) {
  const meta = transfers.get(id);
  if (!meta) return sendJson(res, 404, { error: '传输不存在或已过期' });
  if (!meta.completed) return sendJson(res, 409, { error: '发送方尚未完成上传' });
  if (!isChunkIndex(indexText, meta.chunks)) return sendJson(res, 400, { error: '分片序号不合法' });
  if (!requireDownloadAccess(meta, req, url)) {
    return sendJson(res, 401, { error: '未授权' });
  }

  const ip = clientIp(req);
  if (!rateLimit(ip, 'download', 120, 60_000) || !globalRateLimit('download', 3000, 60_000)) {
    return sendJson(res, 429, { error: '下载过于频繁，请稍后再试' });
  }
  if (activeDownloads >= MAX_CONCURRENT) {
    return sendJson(res, 503, { error: '中继并发已满，请稍后再试' });
  }

  const file = chunkPath(id, Number(indexText));
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    return sendJson(res, 404, { error: '分片不存在' });
  }

  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
  });
  activeDownloads += 1;
  try {
    await pipeline(fs.createReadStream(file), res);
  } finally {
    activeDownloads -= 1;
  }
}

async function deleteTransfer(req, res, id) {
  const meta = transfers.get(id);
  if (!meta) return sendJson(res, 404, { error: '传输不存在或已过期' });
  const token = req.headers['x-upload-token'] || '';
  if (!safeEqual(token, meta.uploadToken)) {
    return sendJson(res, 403, { error: '上传令牌无效' });
  }
  await removeTransfer(id);
  sendNoContent(res);
}

async function serveStatic(req, res, pathname) {
  let relative = decodeURIComponent(pathname);
  if (relative === '/' || !path.extname(relative)) relative = '/index.html';
  const file = path.resolve(DIST_DIR, `.${relative}`);
  if (!file.startsWith(`${DIST_DIR}${path.sep}`) && file !== path.join(DIST_DIR, 'index.html')) {
    return sendText(res, 404, 'Not found');
  }
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) throw new Error('not file');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': path.basename(file) === 'index.html' ? 'no-cache' : 'public, max-age=3600',
    });
    await pipeline(fs.createReadStream(file), res);
  } catch {
    sendText(res, 404, 'Filebridge-Lan UI 尚未构建，请先运行 npm run build。');
  }
}

async function route(req, res) {
  setCors(res);
  if (!isSecureRequest(req)) {
    sendJson(res, 426, { error: '公网中继必须使用 HTTPS' });
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, {
      name: 'Filebridge-Lan Bridge',
      version: VERSION,
      publicUrl: PUBLIC_URL,
      maxBytes: MAX_BYTES,
      maxStorage: MAX_STORAGE,
      ttlHours: TTL_HOURS,
      chunkSize: DEFAULT_CHUNK_SIZE,
    });
    return;
  }

  if (pathname === '/api/transfers' && req.method === 'POST') {
    await createTransfer(req, res);
    return;
  }

  const chunkMatch = /^\/api\/transfers\/([0-9a-f-]{36})\/chunks\/(\d+)$/i.exec(pathname);
  if (chunkMatch) {
    if (req.method === 'PUT') {
      await uploadChunk(req, res, chunkMatch[1], chunkMatch[2]);
      return;
    }
    if (req.method === 'GET') {
      await downloadChunk(req, res, chunkMatch[1], chunkMatch[2], url);
      return;
    }
  }

  const completeMatch = /^\/api\/transfers\/([0-9a-f-]{36})\/complete$/i.exec(pathname);
  if (completeMatch && req.method === 'POST') {
    await completeTransfer(req, res, completeMatch[1]);
    return;
  }

  const deleteMatch = /^\/api\/transfers\/([0-9a-f-]{36})$/i.exec(pathname);
  if (deleteMatch && req.method === 'DELETE') {
    await deleteTransfer(req, res, deleteMatch[1]);
    return;
  }

  const codeMatch = /^\/api\/transfers\/code\/([A-Z0-9]{8})$/i.exec(pathname);
  if (codeMatch && req.method === 'GET') {
    await getByCode(req, res, codeMatch[1], url);
    return;
  }

  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: '接口不存在' });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    await serveStatic(req, res, pathname);
    return;
  }

  sendJson(res, 405, { error: '方法不允许' });
}

async function main() {
  await fsp.mkdir(TRANSFERS_DIR, { recursive: true });
  await loadTransfers();
  await cleanupExpired();
  setInterval(() => { void cleanupExpired(); }, 5 * 60 * 1000).unref();

  const server = http.createServer((req, res) => {
    route(req, res).catch((error) => {
      console.error('[bridge] 请求失败:', error);
      if (!res.headersSent) sendJson(res, 500, { error: '服务器内部错误' });
      else res.end();
    });
  });

  server.on('clientError', (_error, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  server.listen(PORT, HOST, () => {
    log(`Encrypted Relay 启动于 ${PUBLIC_URL} (${HOST}:${PORT})`);
    log(`数据目录: ${DATA_DIR}`);
    log(`上限: ${Math.round(MAX_BYTES / 1024 / 1024)} MB/文件, TTL ${TTL_HOURS}h`);
  });
}

await main();
