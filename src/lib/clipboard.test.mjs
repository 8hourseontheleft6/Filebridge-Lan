import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLIPBOARD_MAX_BYTES,
  clearClipboardText,
  clipboardByteLength,
  clipboardErrorText,
  clipboardStatusDropsText,
  isClipboardTextTooLarge,
  shouldPushSystemClipboard,
  shouldWriteSystemClipboard,
} from './clipboard.ts';

test('byte length counts UTF-8 bytes, not characters', () => {
  assert.equal(clipboardByteLength('abc'), 3);
  assert.equal(clipboardByteLength('中文'), 6);
  assert.equal(clipboardByteLength('🚀'), 4);
  assert.equal(CLIPBOARD_MAX_BYTES, 262144);
});

test('size limit is inclusive at 262144 bytes', () => {
  assert.equal(isClipboardTextTooLarge('a'.repeat(CLIPBOARD_MAX_BYTES - 1)), false);
  assert.equal(isClipboardTextTooLarge('a'.repeat(CLIPBOARD_MAX_BYTES)), false);
  assert.equal(isClipboardTextTooLarge('a'.repeat(CLIPBOARD_MAX_BYTES + 1)), true);
  // 65536 four-byte glyphs are exactly 262144 bytes; one more byte overflows.
  assert.equal(isClipboardTextTooLarge('🚀'.repeat(65536)), false);
  assert.equal(isClipboardTextTooLarge('🚀'.repeat(65536) + 'x'), true);
});

test('a dead session must drop the text instead of keeping it', () => {
  assert.equal(clipboardStatusDropsText(401), true);
  assert.equal(clipboardStatusDropsText(403), true);
  assert.equal(clipboardStatusDropsText(409), false);
  assert.equal(clipboardStatusDropsText(429), false);
  assert.equal(clipboardStatusDropsText(200), false);
});

test('error text maps protocol codes and statuses', () => {
  assert.equal(clipboardErrorText(413, 'clipboard_too_large'), '文本超过 256 KiB 限制');
  assert.equal(clipboardErrorText(409, 'clipboard_disabled'), '文字同步未开启');
  assert.equal(clipboardErrorText(429, 'clipboard_rate_limited'), '文字同步过于频繁，请稍后再试');
  assert.equal(clipboardErrorText(403, 'clipboard_host_only'), '只有电脑端可以切换文字同步');
  assert.equal(clipboardErrorText(401), '连接已失效，请重新配对后再同步');
  assert.equal(clipboardErrorText(400, 'clipboard_bad_request'), '文本格式不正确');
  assert.equal(clipboardErrorText(500), '文字同步失败，请稍后再试');
});

test('clearing text keeps the enabled flag', () => {
  const cleared = clearClipboardText({
    enabled: true,
    text: 'secret',
    hash: 'abc',
    updatedAt: 123,
    source: 'phone',
  });
  assert.equal(cleared.enabled, true);
  assert.equal(cleared.text, '');
  assert.equal(cleared.hash, null);
  assert.equal(cleared.updatedAt, null);
  assert.equal(cleared.source, null);
});

test('desktop pushes only genuinely new system clipboard text', () => {
  const base = { bytes: 10, hash: 'h1', hubHash: 'h0', lastSystemHash: 'h0' };
  assert.equal(shouldPushSystemClipboard(base), true);
  assert.equal(shouldPushSystemClipboard({ ...base, hubHash: 'h1' }), false, 'already on the Hub');
  assert.equal(shouldPushSystemClipboard({ ...base, lastSystemHash: 'h1' }), false, 'own echo');
  assert.equal(shouldPushSystemClipboard({ ...base, hash: '' }), false, 'no hash means no sync');
  assert.equal(
    shouldPushSystemClipboard({ ...base, bytes: CLIPBOARD_MAX_BYTES + 1 }),
    false,
    'oversized system clipboard text is rejected locally',
  );
});

test('desktop writes only text that came from another device', () => {
  const base = {
    desktop: true,
    enabled: true,
    paused: false,
    text: 'hello',
    hubHash: 'h1',
    source: 'phone',
    lastSystemHash: 'h0',
  };
  assert.equal(shouldWriteSystemClipboard(base), true);
  assert.equal(shouldWriteSystemClipboard({ ...base, source: 'desktop' }), false, 'never write own text back');
  assert.equal(shouldWriteSystemClipboard({ ...base, lastSystemHash: 'h1' }), false, 'already written');
  assert.equal(shouldWriteSystemClipboard({ ...base, enabled: false }), false);
  assert.equal(shouldWriteSystemClipboard({ ...base, paused: true }), false, 'paused or offline');
  assert.equal(shouldWriteSystemClipboard({ ...base, desktop: false }), false, 'browser clients never touch the system clipboard');
  assert.equal(shouldWriteSystemClipboard({ ...base, text: '' }), false);
});
