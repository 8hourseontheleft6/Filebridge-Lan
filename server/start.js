/**
 * Filebridge-Lan - 启动脚本
 * 同时启动 HTTP Hub 和 Vite 开发服务器。
 */

const { spawn } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');

const hub = spawn(process.execPath, ['server/hub.mjs'], {
  cwd: root,
  stdio: 'inherit',
});

const vite = spawn('npx vite --host 0.0.0.0', {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});

function shutdown() {
  hub.kill();
  vite.kill();
  process.exit();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
