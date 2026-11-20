/**
 * Clipboard controller.
 *
 * Owns the polling lifecycles (2 s Hub poll, 2.5 s system-clipboard pull), the
 * token-change reset, the auto-enable-once rule and all action wiring. The panel
 * only renders state and owns the text draft.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { clearClipboardText } from '../../lib/clipboard';
import type { ClipboardSnapshot } from './types';
import {
  createClipboardService,
  hashClipboardText,
  shouldAutoEnable,
  validateOutgoingText,
  type ClipboardService,
} from './clipboardService';

const HUB_POLL_MS = 2000;
const SYSTEM_POLL_MS = 2500;
const COPIED_RESET_MS = 1800;

export interface ClipboardControllerOptions {
  token: string;
  desktop: boolean;
  online: boolean | null;
  publicPaused: boolean;
  hostname: string;
  service?: ClipboardService;
}

export interface ClipboardController {
  snapshot: ClipboardSnapshot | null;
  enabled: boolean;
  text: string;
  /** True when sync must not run (public gate, offline or unknown connection). */
  paused: boolean;
  canToggle: boolean;
  busy: boolean;
  copied: boolean;
  notice: string;
  error: string;
  /** Increments whenever the panel must drop its draft (session/text reset). */
  resetKey: number;
  /** Hard text limit for the UI counter. */
  maxBytes: number;
  toggle(): Promise<boolean>;
  send(text: string): Promise<boolean>;
  clear(): Promise<boolean>;
  copyLatest(): Promise<void>;
  /** Reads the clipboard (desktop command or browser API) into the draft. */
  readClipboard(): Promise<string | null>;
  retry(): void;
}

export function useClipboardController({
  token,
  desktop,
  online,
  publicPaused,
  hostname,
  service,
}: ClipboardControllerOptions): ClipboardController {
  const serviceRef = useRef<ClipboardService>(service ?? createClipboardService());
  const [snapshot, setSnapshot] = useState<ClipboardSnapshot | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const hashRef = useRef('');
  const lastSystemHashRef = useRef('');
  const syncingRef = useRef(false);
  const autoEnableRef = useRef(false);
  const copiedTimerRef = useRef<number | null>(null);

  const enabled = Boolean(snapshot?.enabled);
  const text = snapshot?.text || '';
  const paused = publicPaused || online === false || online === null;
  const canToggle = desktop || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);

  const applySnapshot = useCallback((next: ClipboardSnapshot) => {
    setSnapshot(next);
    hashRef.current = next.hash || '';
    if (!next.enabled) setError('');
  }, []);

  const dropText = useCallback((message: string) => {
    setSnapshot((prev) => (prev ? clearClipboardText(prev) : prev));
    setNotice('');
    setError(message);
    setResetKey((value) => value + 1);
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    const result = await serviceRef.current.load(token);
    if (result.ok) {
      applySnapshot(result.value);
      return;
    }
    if (result.dropsText) {
      dropText(result.message);
      return;
    }
    if (!publicPaused && online !== false) setError(result.message);
  }, [applySnapshot, dropText, online, publicPaused, token]);

  // A new connection must never inherit the previous one's text.
  useEffect(() => {
    setSnapshot(null);
    setNotice('');
    setError('');
    hashRef.current = '';
    lastSystemHashRef.current = '';
    setResetKey((value) => value + 1);
  }, [token]);

  // Hub polling: only while the session is online and not paused.
  useEffect(() => {
    if (!token || publicPaused || online === false) {
      setSnapshot((prev) => (prev ? clearClipboardText(prev) : prev));
      return;
    }
    void load();
    const timer = window.setInterval(() => { void load(); }, HUB_POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, online, publicPaused, token]);

  // Desktop -> Hub: read the system clipboard only when it can be synced.
  useEffect(() => {
    if (!desktop || !enabled || paused) return;
    let active = true;
    const pullSystem = async () => {
      if (!active || syncingRef.current || !document.hasFocus()) return;
      syncingRef.current = true;
      try {
        const result = await serviceRef.current.pullSystemText({
          token,
          hubHash: hashRef.current,
          lastSystemHash: lastSystemHashRef.current,
        });
        if (!active) return;
        if (result.kind === 'pushed') {
          lastSystemHashRef.current = result.systemHash;
          applySnapshot(result.snapshot);
        } else if (result.kind === 'failed') {
          if (result.dropsText) dropText(result.message);
          else setError(result.message);
        }
      } finally {
        syncingRef.current = false;
      }
    };
    void pullSystem();
    const timer = window.setInterval(() => { void pullSystem(); }, SYSTEM_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [applySnapshot, desktop, dropText, enabled, paused, token]);

  // Hub -> system clipboard: only text that came from another device.
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void (async () => {
      const result = await serviceRef.current.writeHubText({
        desktop,
        paused,
        snapshot,
        lastSystemHash: lastSystemHashRef.current,
      });
      if (!active) return;
      if (result.kind === 'written') lastSystemHashRef.current = result.systemHash;
      else if (result.kind === 'failed') setError(result.message);
    })();
    return () => { active = false; };
  }, [desktop, paused, snapshot]);

  const toggle = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const target = !enabled;
      const result = await serviceRef.current.setEnabled(token, target);
      if (!result.ok) {
        setError(result.message);
        return enabled;
      }
      applySnapshot(result.value);
      setNotice(result.value.enabled ? '文字同步已开启' : '文字同步已关闭');
      return result.value.enabled;
    } finally {
      setBusy(false);
    }
  }, [applySnapshot, enabled, token]);

  // Desktop default: enable once when the approved session becomes ready.
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  useEffect(() => {
    if (!shouldAutoEnable({
      desktop,
      canToggle,
      paused,
      snapshot,
      alreadyTried: autoEnableRef.current,
    })) return;
    autoEnableRef.current = true;
    void toggleRef.current();
  }, [canToggle, desktop, paused, snapshot]);

  const send = useCallback(async (value: string): Promise<boolean> => {
    const validation = validateOutgoingText(value);
    if (!validation.ok) {
      setError(validation.message);
      return false;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await serviceRef.current.sendText(token, value);
      if (!result.ok) {
        if (result.dropsText) dropText(result.message);
        else setError(result.message);
        return false;
      }
      applySnapshot(result.value);
      if (desktop) lastSystemHashRef.current = result.value.hash || '';
      setNotice('已发送到当前连接');
      return true;
    } finally {
      setBusy(false);
    }
  }, [applySnapshot, desktop, dropText, token]);

  const clear = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError('');
    try {
      const result = await serviceRef.current.clear(token);
      if (!result.ok) {
        if (result.dropsText) dropText(result.message);
        else setError(result.message || '清空失败');
        return false;
      }
      applySnapshot(result.value);
      setResetKey((value) => value + 1);
      setNotice('当前文本已清空');
      return true;
    } finally {
      setBusy(false);
    }
  }, [applySnapshot, dropText, token]);

  const copyLatest = useCallback(async () => {
    if (!text) return;
    setError('');
    const result = await serviceRef.current.copyText(desktop, text);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setCopied(true);
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
  }, [desktop, text]);

  useEffect(() => () => {
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
  }, []);

  const readClipboard = useCallback(async (): Promise<string | null> => {
    setError('');
    setNotice('');
    const result = await serviceRef.current.readClipboardText(desktop);
    if (!result.ok) {
      setError(result.message);
      return null;
    }
    setNotice(desktop ? '已读取系统剪贴板，可点击发送' : '已读取剪贴板，可点击发送');
    return result.value;
  }, [desktop]);

  const retry = useCallback(() => {
    setError('');
    setNotice('');
    void load();
  }, [load]);

  return {
    snapshot,
    enabled,
    text,
    paused,
    canToggle,
    busy,
    copied,
    notice,
    error,
    resetKey,
    maxBytes: serviceRef.current.maxBytes,
    toggle,
    send,
    clear,
    copyLatest,
    readClipboard,
    retry,
  };
}

export { hashClipboardText };
