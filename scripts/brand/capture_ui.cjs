/* Visual check of the shipped build through the local Hub, without DevTools. */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.resolve(__dirname, '..', '..', 'docs', 'screenshots');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connect(port) {
  for (let i = 0; i < 40; i += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('edge devtools not reachable');
}

async function main() {
  const profile = path.join(process.env.TEMP, `fb-shot-${Date.now()}`);
  const port = 9333;
  const child = spawn(EDGE, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    'about:blank',
  ], { stdio: 'ignore' });

  const wsUrl = await connect(port);
  const WebSocket = require('ws');
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      const item = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? item.reject(new Error(msg.error.message)) : item.resolve(msg.result);
    }
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  await send('Page.enable');
  await send('Runtime.enable');
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result?.result?.value;
  };

  for (const [width, height, name] of [[1440, 1000, 'desktop-1440'], [900, 900, 'desktop-900'], [390, 844, 'mobile-390']]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await send('Page.navigate', { url: 'http://127.0.0.1:42080/' });
    await sleep(2500);
    console.log(name + '=' + await evaluate(`JSON.stringify({
      overflow: document.documentElement.scrollWidth - innerWidth,
      brand: !!document.querySelector('.brand-mark'),
      logo: document.querySelector('.brand-mark')?.getAttribute('src'),
      rendered: Math.round(document.querySelector('.brand-mark')?.getBoundingClientRect().width || 0),
      version: document.body.innerText.includes('1.5.6 Preview 2'),
      favicon: document.querySelector('link[rel=icon]')?.getAttribute('href')
    })`));
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(shot.data, 'base64'));
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.querySelector('.side-nav-item:last-of-type')?.click()`);
  await sleep(800);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'settings-1440.png'), Buffer.from(shot.data, 'base64'));

  ws.close();
  child.kill();
  await sleep(300);
  fs.rmSync(profile, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
