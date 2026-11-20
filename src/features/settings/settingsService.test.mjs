import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chooseFolder,
  loadSettings,
  openFolder,
  openProject,
  resetSettings,
  saveSettings,
} from './settingsService.ts';

function fakePort(overrides = {}) {
  const calls = [];
  const port = {
    getDownloadDir: async () => {
      calls.push(['getDownloadDir']);
      return 'C:\\Users\\me\\Downloads\\Filebridge-Lan';
    },
    defaultDownloadDir: async () => {
      calls.push(['defaultDownloadDir']);
      return 'C:\\Users\\me\\Downloads\\Filebridge-Lan';
    },
    setDownloadDir: async (path) => {
      calls.push(['setDownloadDir', path]);
      return path.trim();
    },
    pickDownloadDir: async (current) => {
      calls.push(['pickDownloadDir', current]);
      return 'D:\\Transfers';
    },
    openDownloadDir: async () => {
      calls.push(['openDownloadDir']);
    },
    openExternal: async (url) => {
      calls.push(['openExternal', url]);
    },
    ...overrides,
  };
  return { port, calls };
}

test('initial load reads the saved directory into draft', async () => {
  const { port } = fakePort();
  const loaded = await loadSettings(port);
  assert.equal(loaded.savedDir, 'C:\\Users\\me\\Downloads\\Filebridge-Lan');
  assert.equal(loaded.draft, loaded.savedDir);
  assert.equal(loaded.error, '');
});

test('initial load failure maps to the original message', async () => {
  const { port } = fakePort({
    getDownloadDir: async () => {
      throw new Error('permission denied');
    },
  });
  const loaded = await loadSettings(port);
  assert.equal(loaded.error, '读取设置失败：permission denied');
  assert.equal(loaded.draft, '');
});

test('save persists the draft and reports it back', async () => {
  const { port, calls } = fakePort();
  const result = await saveSettings(port, '  D:\\Transfers  ');
  assert.equal(result.message, '已保存');
  assert.equal(result.savedDir, 'D:\\Transfers');
  assert.deepEqual(calls[0], ['setDownloadDir', '  D:\\Transfers  ']);
});

test('save failure keeps the draft untouched and maps the error', async () => {
  const { port } = fakePort({
    setDownloadDir: async () => {
      throw new Error('invalid path');
    },
  });
  const result = await saveSettings(port, 'Z:\\nope');
  assert.equal(result.draft, null);
  assert.equal(result.error, '保存失败：invalid path');
});

test('reset fills the draft with the default and asks the user to save', async () => {
  const { port } = fakePort();
  const result = await resetSettings(port);
  assert.equal(result.draft, 'C:\\Users\\me\\Downloads\\Filebridge-Lan');
  assert.equal(result.message, '已恢复默认路径，点击“保存”生效');
  assert.equal(result.error, '');
});

test('cancelled folder pick keeps the previous draft', async () => {
  const { port } = fakePort({ pickDownloadDir: async () => null });
  const result = await chooseFolder(port, 'C:\\old');
  assert.equal(result.draft, null);
  assert.equal(result.error, '');
});

test('folder pick passes the current directory and returns the new one', async () => {
  const { port, calls } = fakePort();
  const result = await chooseFolder(port, 'C:\\old');
  assert.equal(result.draft, 'D:\\Transfers');
  assert.deepEqual(calls[0], ['pickDownloadDir', 'C:\\old']);
});

test('open folder failure maps to the original message', async () => {
  const { port } = fakePort({
    openDownloadDir: async () => {
      throw new Error('no such dir');
    },
  });
  const result = await openFolder(port);
  assert.equal(result.error, '打开文件夹失败：no such dir');
});

test('browser mode opens the project link without calling Tauri', async () => {
  const { port, calls } = fakePort();
  const opened = [];
  const result = await openProject(false, port, (url) => { opened.push(url); });
  assert.equal(result.error, '');
  assert.equal(opened.length, 1);
  assert.match(opened[0], /github\.com/);
  assert.deepEqual(calls, []);
});

test('desktop mode opens the project link through the platform adapter', async () => {
  const { port, calls } = fakePort();
  const opened = [];
  const result = await openProject(true, port, (url) => { opened.push(url); });
  assert.equal(result.error, '');
  assert.equal(opened.length, 0);
  assert.equal(calls[0][0], 'openExternal');
  assert.match(calls[0][1], /github\.com/);
});
