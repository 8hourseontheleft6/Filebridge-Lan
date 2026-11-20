/**
 * Clipboard application service.
 *
 * Owns the clipboard sync rules: size checks, hash de-duplication, error
 * mapping (401/403 clears text, 413/429 messages), echo-loop prevention and the
 * desktop/browser clipboard split. It knows nothing about React.
 */
import {
  clearClipboard as apiClearClipboard,
  getClipboard,
  setClipboardEnabled,
  setClipboardText,
} from '../../api/clipboardApi';
import type { ClipboardSnapshot } from '../../api/clipboardApi';
import { ApiError } from '../../api/errors';
import { isTauriHost } from '../../platform/runtime';
import { tauri } from '../../platform/tauri';
import {
  CLIPBOARD_MAX_BYTES,
  clipboardByteLength,
  clipboardErrorText,
  clipboardStatusDropsText,
  clearClipboardText,
  isClipboardTextTooLarge,
  shouldPushSystemClipboard,
  shouldWriteSystemClipboard,
} from '../../lib/clipboard';
import type {
  ClipboardResult,
  SystemPullResult,
  SystemWriteResult,
} from './types';

export interface ClipboardApiPort {
  get(token: string): Promise<ClipboardSnapshot>;
  setText(token: string, text: string): Promise<ClipboardSnapshot>;
  clear(token: string): Promise<ClipboardSnapshot>;
  setEnabled(token: string, enabled: boolean): Promise<ClipboardSnapshot>;
}

export interface ClipboardPlatformPort {
  readSystemText(): Promise<string | null>;
  writeSystemText(text: string): Promise<void>;
}

export const httpClipboardApi: ClipboardApiPort = {
  get: getClipboard,
  setText: setClipboardText,
  clear: apiClearClipboard,
  setEnabled: setClipboardEnabled,
};

export const tauriClipboardPlatform: ClipboardPlatformPort = {
  readSystemText: () => tauri.clipboardReadText(),
  writeSystemText: (text) => tauri.clipboardWriteText(text),
};

/** Map any failure to a user message plus whether stale text must be dropped. */
export function mapClipboardFailure(error: unknown): { message: string; dropsText: boolean } {
  if (error instanceof ApiError) {
    const status = error.status ?? 0;
    return {
      message: clipboardErrorText(status, error.code),
      dropsText: clipboardStatusDropsText(status),
    };
  }
  if (error instanceof Error) {
    return { message: error.message, dropsText: false };
  }
  return { message: '文字同步失败，请稍后再试', dropsText: false };
}

/** SHA-256 hex of the UTF-8 text; empty when WebCrypto is unavailable. */
export async function hashClipboardText(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) return '';
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Local validation before a send; keeps 256 KiB text out of the Hub entirely. */
export function validateOutgoingText(text: string): { ok: true } | { ok: false; message: string } {
  if (!text) return { ok: false, message: '文本不能为空' };
  if (isClipboardTextTooLarge(text)) {
    return {
      ok: false,
      message: `文本 ${clipboardByteLength(text)} 字节，超过 256 KiB 限制`,
    };
  }
  return { ok: true };
}

/** Desktop default: enable once per accepted session unless the user disables it. */
export function shouldAutoEnable(options: {
  desktop: boolean;
  canToggle: boolean;
  paused: boolean;
  snapshot: ClipboardSnapshot | null;
  alreadyTried: boolean;
}): boolean {
  const { desktop, canToggle, paused, snapshot, alreadyTried } = options;
  if (!desktop || !canToggle || paused || alreadyTried) return false;
  if (!snapshot) return false;
  return !snapshot.enabled;
}

export function canToggleFromThisDevice(hostname: string): boolean {
  if (isTauriHost()) return true;
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
}

export interface ClipboardService {
  load(token: string): Promise<ClipboardResult<ClipboardSnapshot>>;
  sendText(token: string, text: string): Promise<ClipboardResult<ClipboardSnapshot>>;
  setEnabled(token: string, enabled: boolean): Promise<ClipboardResult<ClipboardSnapshot>>;
  clear(token: string): Promise<ClipboardResult<ClipboardSnapshot>>;
  pullSystemText(options: {
    token: string;
    hubHash: string;
    lastSystemHash: string;
  }): Promise<SystemPullResult>;
  writeHubText(options: {
    desktop: boolean;
    paused: boolean;
    snapshot: ClipboardSnapshot | null;
    lastSystemHash: string;
  }): Promise<SystemWriteResult>;
  readClipboardText(desktop: boolean): Promise<ClipboardResult<string>>;
  copyText(desktop: boolean, text: string): Promise<ClipboardResult<true>>;
  hash(text: string): Promise<string>;
  maxBytes: number;
}

function browserClipboardAvailable(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.clipboard);
}

export function createClipboardService(
  api: ClipboardApiPort = httpClipboardApi,
  platform: ClipboardPlatformPort = tauriClipboardPlatform,
): ClipboardService {
  async function guard<T>(run: () => Promise<T>): Promise<ClipboardResult<T>> {
    try {
      return { ok: true, value: await run() };
    } catch (error) {
      const failure = mapClipboardFailure(error);
      return { ok: false, message: failure.message, dropsText: failure.dropsText };
    }
  }

  return {
    maxBytes: CLIPBOARD_MAX_BYTES,

    load: (token) => guard(() => api.get(token)),

    sendText: (token, text) => {
      const validation = validateOutgoingText(text);
      if (!validation.ok) {
        return Promise.resolve({ ok: false, message: validation.message, dropsText: false });
      }
      return guard(() => api.setText(token, text));
    },

    setEnabled: (token, enabled) => guard(() => api.setEnabled(token, enabled)),

    clear: (token) => guard(() => api.clear(token)),

    async pullSystemText({ token, hubHash, lastSystemHash }): Promise<SystemPullResult> {
      let value: string | null;
      try {
        value = await platform.readSystemText();
      } catch (error) {
        return { kind: 'failed', message: `读取系统剪贴板失败：${String(error)}`, dropsText: false };
      }
      if (!value) return { kind: 'skipped' };
      if (isClipboardTextTooLarge(value)) {
        return {
          kind: 'failed',
          message: `系统剪贴板文本 ${clipboardByteLength(value)} 字节，超过 256 KiB，未同步`,
          dropsText: false,
        };
      }
      const hash = await hashClipboardText(value);
      if (!shouldPushSystemClipboard({
        bytes: clipboardByteLength(value),
        hash,
        hubHash,
        lastSystemHash,
      })) {
        return { kind: 'skipped' };
      }
      const result = await guard(() => api.setText(token, value as string));
      if (!result.ok) {
        return { kind: 'failed', message: result.message, dropsText: result.dropsText };
      }
      return { kind: 'pushed', snapshot: result.value, systemHash: hash };
    },

    async writeHubText({ desktop, paused, snapshot, lastSystemHash }): Promise<SystemWriteResult> {
      const text = snapshot?.text || '';
      if (!shouldWriteSystemClipboard({
        desktop,
        enabled: Boolean(snapshot?.enabled),
        paused,
        text,
        hubHash: snapshot?.hash ?? null,
        source: snapshot?.source ?? null,
        lastSystemHash,
      })) {
        return { kind: 'skipped' };
      }
      try {
        await platform.writeSystemText(text);
      } catch (error) {
        return { kind: 'failed', message: `写入系统剪贴板失败：${String(error)}` };
      }
      return { kind: 'written', systemHash: snapshot?.hash || '' };
    },

    async readClipboardText(desktop): Promise<ClipboardResult<string>> {
      if (desktop) {
        let value: string | null;
        try {
          value = await platform.readSystemText();
        } catch (error) {
          return { ok: false, message: String(error), dropsText: false };
        }
        if (value == null) return { ok: false, message: '系统剪贴板没有文本', dropsText: false };
        return { ok: true, value };
      }
      if (!browserClipboardAvailable()) {
        return { ok: false, message: '当前浏览器不允许读取剪贴板', dropsText: false };
      }
      try {
        const value = await navigator.clipboard.readText();
        if (!value) return { ok: false, message: '浏览器剪贴板为空', dropsText: false };
        return { ok: true, value };
      } catch {
        return { ok: false, message: '无法读取剪贴板，请手动粘贴', dropsText: false };
      }
    },

    async copyText(desktop, text): Promise<ClipboardResult<true>> {
      try {
        if (desktop) await platform.writeSystemText(text);
        else {
          if (!navigator.clipboard?.writeText) {
            return { ok: false, message: '当前浏览器不允许自动复制', dropsText: false };
          }
          await navigator.clipboard.writeText(text);
        }
        return { ok: true, value: true };
      } catch {
        return {
          ok: false,
          message: desktop ? '写入系统剪贴板失败，请手动复制' : '浏览器未允许自动复制，请长按/选择文本手动复制',
          dropsText: false,
        };
      }
    },

    hash: hashClipboardText,
  };
}

export { clearClipboardText };
