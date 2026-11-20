import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { ApiError } from '../../api/errors.ts';
import {
  SESSION_STORAGE_KEY,
  TOKEN_STORAGE_KEY,
  clearPersistedToken,
  exchangePairingCode,
  initialSessionState,
  loadInitialSession,
  normalizeCodeInput,
  pairErrorText,
  persistCode,
  persistToken,
  readCodeFromHash,
  readPersistedSession,
  recoverLocalSession,
  rotateErrorText,
  rotatePairingCode,
  sessionAfterConnected,
  sessionAfterExpired,
  sessionAfterPair,
  sessionAfterPairFailure,
  sessionAfterRotate,
  sessionStatus,
} from './sessionService.ts';

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

function fakeApi(overrides = {}) {
  const calls = [];
  return {
    calls,
    readLocalSessionCode: async () => {
      calls.push(['readLocalSessionCode']);
      return null;
    },
    pair: async (code) => {
      calls.push(['pair', code]);
      return { token: `token-${code}`, expiresAt: 123 };
    },
    rotate: async () => {
      calls.push(['rotate']);
      return { code: '999999' };
    },
    ...overrides,
  };
}

const BASE = {
  sessionCode: '',
  token: '',
  sessionReady: true,
  codeError: '',
  codeInput: '',
  rotating: false,
};

test('hash code wins over the persisted code and is persisted', async () => {
  const storage = memoryStorage({ [SESSION_STORAGE_KEY]: '222222' });
  const api = fakeApi();
  const result = await loadInitialSession({
    hash: '#code=111111',
    storage,
    api,
    localHubAccess: false,
  });
  assert.equal(result.sessionCode, '111111');
  assert.equal(result.token, 'token-111111');
  assert.deepEqual(api.calls[0], ['pair', '111111']);
  assert.equal(storage.getItem(SESSION_STORAGE_KEY), '111111');
});

test('without a hash code the persisted code is restored', async () => {
  const storage = memoryStorage({ [SESSION_STORAGE_KEY]: '222222' });
  const result = await loadInitialSession({
    hash: '',
    storage,
    api: fakeApi(),
    localHubAccess: false,
  });
  assert.equal(result.sessionCode, '222222');
  assert.equal(result.token, 'token-222222');
});

test('unavailable or corrupted storage yields an empty state', async () => {
  assert.deepEqual(readPersistedSession(null), { code: '', token: '' });
  const broken = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
    removeItem: () => { throw new Error('blocked'); },
  };
  assert.deepEqual(readPersistedSession(broken), { code: '', token: '' });
  const result = await loadInitialSession({ hash: '', storage: broken, api: fakeApi(), localHubAccess: false });
  assert.equal(result.token, '');
  assert.equal(result.sessionCode, '');
  const state = initialSessionState('', broken);
  assert.equal(state.sessionCode, '');
  assert.equal(state.token, '');
});

test('tokens are persisted only through the session storage adapter', () => {
  const storage = memoryStorage();
  persistToken(storage, 'tok-1');
  persistCode(storage, '123456');
  assert.deepEqual([...storage.map.keys()].sort(), [SESSION_STORAGE_KEY, TOKEN_STORAGE_KEY].sort());
  // Empty tokens are never written.
  persistToken(storage, '');
  assert.equal(storage.getItem(TOKEN_STORAGE_KEY), 'tok-1');
});

test('a successful pair persists the token and clears the error', async () => {
  const storage = memoryStorage();
  const result = await loadInitialSession({
    hash: '#code=123456',
    storage,
    api: fakeApi(),
    localHubAccess: false,
  });
  assert.equal(result.codeError, '');
  assert.equal(result.codeInput, '');
  assert.equal(storage.getItem(TOKEN_STORAGE_KEY), 'token-123456');
  const state = sessionAfterPair(BASE, result.sessionCode, result.token);
  assert.equal(sessionStatus(state), 'paired');
});

test('a failed pair clears the token, keeps the code and shows the original copy', async () => {
  const storage = memoryStorage({ [TOKEN_STORAGE_KEY]: 'stale-token' });
  const api = fakeApi({
    pair: async () => { throw ApiError.http(401); },
  });
  const result = await loadInitialSession({
    hash: '#code=123456',
    storage,
    api,
    localHubAccess: false,
  });
  assert.equal(result.token, '');
  assert.equal(result.sessionCode, '123456');
  assert.equal(result.codeInput, '123456');
  assert.equal(result.codeError, '配对码错误，请检查电脑上显示的 6 位配对码');
  assert.equal(storage.getItem(TOKEN_STORAGE_KEY), null);

  const state = sessionAfterPairFailure(BASE, result.sessionCode, result.codeError);
  assert.equal(sessionStatus(state), 'needs_pairing');
  assert.equal(state.codeInput, '123456');
});

test('rotation returns the new code and the next state drops the old token', async () => {
  const api = fakeApi();
  const code = await rotatePairingCode(api);
  assert.equal(code, '999999');

  const oldState = sessionAfterPair(BASE, '111111', 'old-token');
  const next = sessionAfterRotate(oldState, code, 'token-999999');
  assert.equal(next.sessionCode, '999999');
  assert.equal(next.token, 'token-999999');
  assert.notEqual(next.token, oldState.token);

  const storage = memoryStorage();
  persistCode(storage, code);
  assert.equal(storage.getItem(SESSION_STORAGE_KEY), '999999');
});

test('the loopback session code overrides the persisted code on the desktop', async () => {
  const storage = memoryStorage({ [SESSION_STORAGE_KEY]: '222222' });
  const api = fakeApi({ readLocalSessionCode: async () => '777777' });
  const result = await loadInitialSession({ hash: '', storage, api, localHubAccess: true });
  assert.equal(result.sessionCode, '777777');
  assert.deepEqual(api.calls.map((call) => call[1]), ['777777']);
  assert.equal(storage.getItem(SESSION_STORAGE_KEY), '777777');
});

test('Hub restart recovery returns and persists a fresh token', async () => {
  const storage = memoryStorage({ [SESSION_STORAGE_KEY]: '777777' });
  const api = fakeApi({ readLocalSessionCode: async () => '777777' });
  const result = await recoverLocalSession({ storage, api });
  assert.deepEqual(result, { sessionCode: '777777', token: 'token-777777' });
  assert.equal(storage.getItem(TOKEN_STORAGE_KEY), 'token-777777');

  const state = sessionAfterPair(BASE, result.sessionCode, result.token);
  assert.equal(sessionStatus(state), 'paired');
});

test('a failed recovery does not overwrite a valid stored token', async () => {
  const storage = memoryStorage({ [TOKEN_STORAGE_KEY]: 'valid-token' });
  const api = fakeApi({
    readLocalSessionCode: async () => '777777',
    pair: async () => { throw new ApiError({ kind: 'network', message: 'offline' }); },
  });
  await assert.rejects(() => recoverLocalSession({ storage, api }));
  assert.equal(storage.getItem(TOKEN_STORAGE_KEY), 'valid-token');
});

test('no recovery attempt happens when the Hub exposes no local code', async () => {
  const storage = memoryStorage();
  const result = await recoverLocalSession({ storage, api: fakeApi() });
  assert.equal(result, null);
  assert.equal(storage.map.size, 0);
});

test('tokens never leak into URLs, logs or error text', () => {
  const text = pairErrorText(ApiError.http(429));
  assert.match(text, /尝试次数过多/);
  assert.equal(text.includes('token-'), false);

  const rotateText = rotateErrorText(ApiError.http(403));
  assert.match(rotateText, /只有电脑本机/);

  // Source audit: the session feature must not log secrets or put them in URLs.
  const root = path.resolve(import.meta.dirname);
  const offenders = fs.readdirSync(root)
    .filter((name) => /\.(ts|tsx)$/.test(name))
    .filter((name) => {
      const source = fs.readFileSync(path.join(root, name), 'utf8');
      if (/console\.[a-z]+\([^)]*(token|code)/i.test(source)) return true;
      if (/[?&]token=/.test(source)) return true;
      return false;
    });
  assert.deepEqual(offenders, []);
});

test('cleanup only removes the token key and keeps unrelated data', () => {
  const storage = memoryStorage({
    [SESSION_STORAGE_KEY]: '123456',
    [TOKEN_STORAGE_KEY]: 'tok',
    'other-app-key': 'keep-me',
  });
  clearPersistedToken(storage);
  assert.equal(storage.getItem(TOKEN_STORAGE_KEY), null);
  assert.equal(storage.getItem(SESSION_STORAGE_KEY), '123456');
  assert.equal(storage.getItem('other-app-key'), 'keep-me');
});

test('code helpers accept only six digits', () => {
  assert.equal(readCodeFromHash('#code=123456'), '123456');
  assert.equal(readCodeFromHash('#code=%20123456%20'), '123456');
  assert.equal(readCodeFromHash('#other=1'), '');
  assert.equal(readCodeFromHash(''), '');
  assert.equal(normalizeCodeInput('12ab34c5678'), '123456');
  assert.equal(normalizeCodeInput('1234567'), '123456');
});

test('state transitions cover loading, pairing, expiry and token reset keys', () => {
  const loading = { ...BASE, sessionReady: false };
  assert.equal(sessionStatus(loading), 'loading');

  const paired = sessionAfterPair(loading, '123456', 'token-a');
  assert.equal(sessionStatus(paired), 'paired');

  const expired = sessionAfterExpired(paired, '授权已过期，请重新配对');
  assert.equal(sessionStatus(expired), 'needs_pairing');
  assert.equal(expired.codeError, '授权已过期，请重新配对');

  const repaired = sessionAfterPair(expired, '654321', 'token-b');
  assert.equal(sessionStatus(repaired), 'paired');
  assert.equal(repaired.codeError, '');

  // The clipboard panel resets on token change; a re-pair must produce a new one.
  assert.notEqual(repaired.token, paired.token);

  const connected = sessionAfterConnected(expired, 'token-c');
  assert.equal(sessionStatus(connected), 'paired');
  assert.equal(connected.codeError, '');
});

test('pairing failures map HTTP statuses to the original copy', async () => {
  const cases = [
    [401, /配对码错误/],
    [429, /尝试次数过多/],
    [403, /当前网络不允许配对/],
    [500, /无法连接 Filebridge-Lan Hub/],
  ];
  for (const [status, pattern] of cases) {
    const api = fakeApi({ pair: async () => { throw ApiError.http(status); } });
    await assert.rejects(
      () => exchangePairingCode('123456', api),
      (error) => {
        assert.match(error.message, pattern);
        return true;
      },
    );
  }
});
