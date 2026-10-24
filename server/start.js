/**
 * Filebridge-Lan - 启动脚本
 * 同时启动 HTTP Hub、信令服务器和 Vite 开发服务器
 */

const { spawn } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');

// HTTP Hub（手机浏览器直传，端口 42080）
const hub = spawn(process.execPath, ['server/hub.mjs'], {
  cwd: root,
  stdio: 'inherit',
});

// 信令服务器（WebRTC 房间，端口 42070）
const signal = spawn('npx tsx server/signaling.ts', {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});

// Vite（桌面/手机开发页面，端口 5173）
const vite = spawn('npx vite --host 0.0.0.0', {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});

function shutdown() {
  hub.kill();
  signal.kill();
  vite.kill();
  process.exit();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
