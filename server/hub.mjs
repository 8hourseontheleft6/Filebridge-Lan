/**
 * Filebridge-Lan - HTTP Hub (MVP)
 *
 * 目标：让手机浏览器用最普通的 HTTP 上传/下载大文件。
 * - 上传：请求体直接是文件字节，流式写入 .part，边写边算 SHA-256
 * - 下载：支持 Content-Disposition / Range，交给浏览器原生下载器
 * - 不依赖 secure context、Service Worker、WebRTC、外部 CDN
 *
 * 启动：node server/hub.mjs
 * 端口：42080（避免与信令 42070 冲突）
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const LEGACY_DATA_DIR = path.join(ROOT, '.filebridge-data');
const DEFAULT_DATA_DIR = path.join(ROOT, '.filebridge-lan-data');
const DATA_DIR = process.env.FILEBRIDGE_LAN_HUB_DATA
  ? path.resolve(process.env.FILEBRIDGE_LAN_HUB_DATA)
  : (fs.existsSync(LEGACY_DATA_DIR) && !fs.existsSync(DEFAULT_DATA_DIR)
    ? LEGACY_DATA_DIR
    : DEFAULT_DATA_DIR);
const FILES_DIR = path.join(DATA_DIR, 'files');
const META_DIR = path.join(DATA_DIR, 'meta');
const TMP_DIR = path.join(DATA_DIR, 'tmp');

const PORT = Number(process.env.FILEBRIDGE_LAN_HUB_PORT || 42080);
const HOST = process.env.FILEBRIDGE_LAN_HUB_HOST || '0.0.0.0';
const VERSION = '1.3.1';

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

/** @type {Map<string, {id:string,name:string,size:number,sha256:string,mime:string,createdAt:number}>} */
const metaMap = new Map();

/** @type {Set<import('node:http').ServerResponse>} */
const sseClients = new Set();

function broadcastUpload(event) {
  const payload = `event: upload\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function log(...args) {
  console.log('[hub]', ...args);
}

function lanIps() {
  const result = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const addr of addresses || []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        result.push({ iface: name, ip: addr.address });
      }
    }
  }
  return result;
}

function primaryIps() {
  const ips = lanIps();
  // 优先常见私网网段，过滤掉虚拟网卡的概率更高
  const preferred = ips.filter(({ ip }) =>
    /^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
  return (preferred.length ? preferred : ips).map((x) => x.ip);
}

function sanitizeName(raw) {
  const base = String(raw || 'file').split(/[\\/]/).pop() || 'file';
  let safe = base
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .replace(/^\s+|\s+$/g, '')
    .slice(0, 200);
  if (!safe) safe = 'file';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(safe)) {
    safe = `_${safe}`;
  }
  return safe;
}

function contentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Disposition');
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

function filePath(id) {
  return path.join(FILES_DIR, `${id}.bin`);
}

function metaPath(id) {
  return path.join(META_DIR, `${id}.json`);
}

async function ensureDirs() {
  await fsp.mkdir(FILES_DIR, { recursive: true });
  await fsp.mkdir(META_DIR, { recursive: true });
  await fsp.mkdir(TMP_DIR, { recursive: true });
}

async function loadMeta() {
  let entries = [];
  try {
    entries = await fsp.readdir(META_DIR);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const raw = await fsp.readFile(path.join(META_DIR, entry), 'utf8');
      const meta = JSON.parse(raw);
      if (!meta?.id || !meta?.name) continue;
      await fsp.access(filePath(meta.id));
      metaMap.set(meta.id, meta);
    } catch {
      // 忽略损坏/孤立的元数据
    }
  }
  log(`已加载 ${metaMap.size} 个文件索引`);
}

async function handleUpload(req, res, url) {
  const rawName = url.searchParams.get('name');
  if (!rawName) {
    sendJson(res, 400, { error: '缺少 name 参数' });
    return;
  }

  const name = sanitizeName(rawName);
  const id = crypto.randomUUID();
  const part = path.join(TMP_DIR, `${id}.part`);
  const total = Number(req.headers['content-length'] || 0);
  const hash = crypto.createHash('sha256');
  const ws = fs.createWriteStream(part, { flags: 'wx' });

  let received = 0;
  let aborted = false;
  let lastEmit = 0;

  const broadcast = (status) => {
    broadcastUpload({ id, name, loaded: received, total, status });
  };

  const cleanup = async () => {
    try { await fsp.unlink(part); } catch { /* ignore */ }
  };

  broadcast('started');
  req.on('data', (chunk) => {
    received += chunk.length;
    hash.update(chunk);
    const now = Date.now();
    if (now - lastEmit >= 200) {
      lastEmit = now;
      broadcast('progress');
    }
  });
  req.on('aborted', () => {
    aborted = true;
    ws.destroy();
    broadcast('failed');
    void cleanup();
  });
  req.on('error', () => {
    aborted = true;
    ws.destroy();
    broadcast('failed');
    void cleanup();
  });

  req.pipe(ws);

  try {
    await new Promise((resolve, reject) => {
      ws.on('finish', resolve);
      ws.on('close', resolve);
      ws.on('error', reject);
      req.on('error', reject);
    });
  } catch (error) {
    ws.destroy();
    await cleanup();
    if (!aborted) {
      broadcast('failed');
      sendJson(res, 500, { error: `写入失败: ${error.message}` });
    }
    return;
  }

  if (aborted) {
    await cleanup();
    return;
  }

  if (total > 0 && received !== total) {
    await cleanup();
    broadcast('failed');
    sendJson(res, 400, { error: `上传不完整：期望 ${total}，实际 ${received}` });
    return;
  }

  const finalPath = filePath(id);
  try {
    await fsp.rename(part, finalPath);
  } catch (error) {
    await cleanup();
    broadcast('failed');
    sendJson(res, 500, { error: `保存失败: ${error.message}` });
    return;
  }

  const meta = {
    id,
    name,
    size: received,
    sha256: hash.digest('hex'),
    mime: String(req.headers['content-type'] || 'application/octet-stream').split(';')[0],
    createdAt: Date.now(),
  };

  try {
    await fsp.writeFile(metaPath(id), JSON.stringify(meta, null, 2));
  } catch (error) {
    await fsp.unlink(finalPath).catch(() => {});
    broadcast('failed');
    sendJson(res, 500, { error: `写入元数据失败: ${error.message}` });
    return;
  }

  metaMap.set(id, meta);
  log(`上传完成: ${name} (${received} bytes, sha256=${meta.sha256.slice(0, 12)}…)`);
  broadcast('completed');
  sendJson(res, 201, meta);
}

async function handleDownload(req, res, id) {
  const meta = metaMap.get(id);
  if (!meta) {
    sendJson(res, 404, { error: '文件不存在' });
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(filePath(id));
  } catch {
    metaMap.delete(id);
    sendJson(res, 404, { error: '文件已丢失' });
    return;
  }

  const headers = {
    'Content-Type': meta.mime || 'application/octet-stream',
    'Content-Disposition': contentDisposition(meta.name),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  };

  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }

    let start;
    let end;

    if (!match[1] && match[2]) {
      // suffix range: bytes=-1024（最后 1024 字节）
      const suffix = Number(match[2]);
      if (!Number.isFinite(suffix) || suffix <= 0) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }
      start = Math.max(0, stat.size - suffix);
      end = stat.size - 1;
    } else {
      start = match[1] ? Number(match[1]) : 0;
      end = match[2] ? Number(match[2]) : stat.size - 1;
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    end = Math.min(end, stat.size - 1);

    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': end - start + 1,
    });
    fs.createReadStream(filePath(id), { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  fs.createReadStream(filePath(id)).pipe(res);
}

async function handleDelete(res, id) {
  const meta = metaMap.get(id);
  if (!meta) {
    sendJson(res, 404, { error: '文件不存在' });
    return;
  }
  metaMap.delete(id);
  await fsp.unlink(filePath(id)).catch(() => {});
  await fsp.unlink(metaPath(id)).catch(() => {});
  log(`删除文件: ${meta.name}`);
  res.writeHead(204);
  res.end();
}

async function serveStatic(req, res, pathname) {
  let rel = pathname;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    sendJson(res, 400, { error: '非法路径' });
    return;
  }
  if (rel === '/') rel = '/index.html';

  const target = path.resolve(DIST, `.${rel}`);
  if (target !== DIST && !target.startsWith(`${DIST}${path.sep}`)) {
    sendJson(res, 403, { error: '禁止访问' });
    return;
  }

  try {
    const stat = await fsp.stat(target);
    if (stat.isFile()) {
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      fs.createReadStream(target).pipe(res);
      return;
    }
  } catch {
    // fall through to SPA fallback
  }

  // SPA fallback
  const index = path.join(DIST, 'index.html');
  try {
    const stat = await fsp.stat(index);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(index).pipe(res);
  } catch {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Filebridge-Lan UI 尚未构建。请运行 npm run build，或使用 Vite 开发服务器 :5173。');
  }
}

async function route(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname === '/api/info' && req.method === 'GET') {
    sendJson(res, 200, {
      name: 'Filebridge-Lan Hub',
      version: VERSION,
      port: PORT,
      ips: primaryIps(),
      files: metaMap.size,
    });
    return;
  }

  if (pathname === '/api/events' && req.method === 'GET') {
    setCors(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    sseClients.add(res);

    const timer = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(timer);
        sseClients.delete(res);
      }
    }, 15000);

    const cleanup = () => {
      clearInterval(timer);
      sseClients.delete(res);
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
    return;
  }

  if (pathname === '/api/files' && req.method === 'GET') {
    const files = Array.from(metaMap.values()).sort((a, b) => b.createdAt - a.createdAt);
    sendJson(res, 200, files);
    return;
  }

  if (pathname === '/api/upload' && req.method === 'POST') {
    await handleUpload(req, res, url);
    return;
  }

  const fileMatch = /^\/api\/files\/([0-9a-f-]+)$/i.exec(pathname);
  if (fileMatch) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      await handleDownload(req, res, fileMatch[1]);
      return;
    }
    if (req.method === 'DELETE') {
      await handleDelete(res, fileMatch[1]);
      return;
    }
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
  await ensureDirs();
  await loadMeta();

  const server = http.createServer((req, res) => {
    route(req, res).catch((error) => {
      console.error('[hub] 请求处理失败:', error);
      if (!res.headersSent) sendJson(res, 500, { error: '服务器内部错误' });
      else res.end();
    });
  });

  server.on('clientError', (err, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  server.listen(PORT, HOST, () => {
    log(`HTTP Hub 启动于 http://${HOST}:${PORT}`);
    for (const ip of primaryIps()) {
      log(`  手机访问: http://${ip}:${PORT}`);
    }
    log(`  数据目录: ${DATA_DIR}`);
  });

  const shutdown = () => {
    log('正在关闭…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[hub] 启动失败:', error);
  process.exit(1);
});
