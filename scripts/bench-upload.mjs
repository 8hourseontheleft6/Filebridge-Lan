/**
 * Filebridge-Lan 上传基准客户端
 *
 * 用法：node scripts/bench-upload.mjs <url> <file> [chunkSize]
 * 例：  node scripts/bench-upload.mjs http://127.0.0.1:42080/api/upload?name=bench.bin ./test.bin 1048576
 *
 * 只用于本地验证/对比 Hub 吞吐，不参与构建。
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';

const [urlArg, fileArg, chunkArg] = process.argv.slice(2);
if (!urlArg || !fileArg) {
  console.error('用法: node scripts/bench-upload.mjs <url> <file> [chunkSize]');
  process.exit(1);
}

const url = new URL(urlArg);
const file = path.resolve(fileArg);
const chunkSize = Number(chunkArg || 1024 * 1024);
if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
  console.error('chunkSize 必须是正整数');
  process.exit(1);
}

const stat = fs.statSync(file);
const hash = crypto.createHash('sha256');
let sent = 0;

const read = fs.createReadStream(file, { highWaterMark: chunkSize });
read.on('data', (chunk) => {
  hash.update(chunk);
  sent += chunk.length;
});

const started = process.hrtime.bigint();

const response = new Promise((resolve, reject) => {
  const req = http.request(
    {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
      },
    },
    (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }
  );
  req.on('error', reject);
  pipeline(read, req).catch(reject);
});

const result = await response;
const seconds = Number(process.hrtime.bigint() - started) / 1e9;
const mbps = stat.size / 1024 / 1024 / seconds;
const clientSha256 = hash.digest('hex');

let meta = null;
try {
  meta = JSON.parse(result.body);
} catch {
  // ignore
}

console.log(JSON.stringify({
  status: result.status,
  file: path.basename(file),
  bytes: sent,
  seconds: Number(seconds.toFixed(3)),
  mbps: Number(mbps.toFixed(1)),
  clientSha256,
  serverSha256: meta?.sha256 ?? null,
  hashMatch: meta?.sha256 ? meta.sha256 === clientSha256 : null,
}, null, 2));
