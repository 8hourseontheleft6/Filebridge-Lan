/**
 * Session controller.
 *
 * Owns pairing/token lifecycle for the transfer page: initial load, automatic
 * loopback recovery after a Hub restart, manual pairing, rotation, token expiry
 * and the child-window `filebridge-peer-connected` notification. The page only
 * consumes state and calls these actions.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  TOKEN_STORAGE_KEY,
  browserSessionStorage,
  clearPersistedToken,
  exchangePairingCode,
  httpSessionApi,
  initialSessionState,
  loadInitialSession,
  normalizeCodeInput,
  persistCode,
  persistToken,
  recoverLocalSession,
  rotatePairingCode,
  sessionAfterConnected,
  sessionAfterExpired,
  sessionAfterPair,
  sessionAfterPairFailure,
  sessionAfterRotate,
  sessionStatus,
} from './sessionService';
import type {
  ConnectionTokenResult,
  SessionApiPort,
  SessionState,
  SessionStatus,
} from './types';

export const RECOVERY_POLL_MS = 3000;

export interface SessionControllerOptions {
  /** Desktop shell (Tauri). */
  desktop: boolean;
  /** The local host may read `/api/session` through loopback. */
  localHubAccess: boolean;
  api?: SessionApiPort;
  /** Called when the automatic post-restart recovery succeeded. */
  onRecovered?: () => void;
}

export interface SessionController extends SessionState {
  status: SessionStatus;
  setCodeInput(value: string): void;
  /** Pair with the current `codeInput`. `preCommit` may veto the token. */
  unlock(options?: { preCommit?: (token: string) => Promise<void> }): Promise<boolean>;
  rotatePairing(): Promise<boolean>;
  /** Token rejected by the Hub: drop it and keep the session code. */
  expireToken(message: string): void;
  /** Token approved by the host (connect-request flow). */
  acceptConnectedToken(token: string, expiresAt: number): void;
}

export function useSessionController({
  desktop,
  localHubAccess,
  api = httpSessionApi,
  onRecovered,
}: SessionControllerOptions): SessionController {
  const storageRef = useRef(browserSessionStorage());
  const [state, setState] = useState<SessionState>(() =>
    initialSessionState(typeof window === 'undefined' ? '' : window.location.hash, storageRef.current),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const aliveRef = useRef(true);
  const loadedRef = useRef(false);
  const recoveringRef = useRef(false);
  const onRecoveredRef = useRef(onRecovered);
  onRecoveredRef.current = onRecovered;
  void desktop;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Initial load: hash or persisted code, then the loopback session code (desktop).
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void (async () => {
      const result = await loadInitialSession({
        hash: typeof window === 'undefined' ? '' : window.location.hash,
        storage: storageRef.current,
        api,
        localHubAccess,
      });
      if (!aliveRef.current) return;
      setState((prev) => ({ ...prev, ...result, sessionReady: true }));
    })();
  }, [api, localHubAccess]);

  // Hub restarted after a Public pause: the old in-memory token is invalid, but a
  // local Hub still exposes its session code through loopback. Retry quietly.
  useEffect(() => {
    if (!state.sessionReady || state.token || !localHubAccess) return;
    let active = true;
    const recover = async () => {
      if (recoveringRef.current) return;
      recoveringRef.current = true;
      try {
        const result = await recoverLocalSession({ storage: storageRef.current, api });
        if (!active || !result) return;
        setState((prev) => sessionAfterPair(prev, result.sessionCode, result.token));
        onRecoveredRef.current?.();
      } catch {
        // Hub is still stopped or restarting; the next tick retries silently.
      } finally {
        recoveringRef.current = false;
      }
    };
    void recover();
    const timer = window.setInterval(() => { void recover(); }, RECOVERY_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [api, localHubAccess, state.sessionReady, state.token]);

  // A child window (embedded peer Hub) tells its parent that pairing is done.
  useEffect(() => {
    if (!state.token || typeof window === 'undefined' || window.parent === window) return;
    try {
      window.parent.postMessage({ type: 'filebridge-peer-connected' }, '*');
    } catch {
      // Cross-window notification failure does not affect transfers.
    }
  }, [state.token]);

  const setCodeInput = useCallback((value: string) => {
    setState((prev) => ({ ...prev, codeInput: normalizeCodeInput(value) }));
  }, []);

  const expireToken = useCallback((message: string) => {
    clearPersistedToken(storageRef.current);
    setState((prev) => sessionAfterExpired(prev, message));
  }, []);

  const acceptConnectedToken = useCallback((token: string, _expiresAt: number) => {
    persistToken(storageRef.current, token);
    setState((prev) => sessionAfterConnected(prev, token));
  }, []);

  const unlock = useCallback(async (options?: { preCommit?: (token: string) => Promise<void> }) => {
    const code = stateRef.current.codeInput.trim();
    if (!/^\d{6}$/.test(code)) {
      setState((prev) => ({ ...prev, codeError: '请输入电脑上显示的 6 位数字配对码' }));
      return false;
    }
    setState((prev) => ({ ...prev, codeError: '' }));

    let paired: ConnectionTokenResult;
    try {
      paired = await exchangePairingCode(code, api);
    } catch (error) {
      const message = error instanceof Error ? error.message : '连接失败';
      clearPersistedToken(storageRef.current);
      setState((prev) => sessionAfterPairFailure(prev, code, message));
      return false;
    }

    if (options?.preCommit) {
      try {
        await options.preCommit(paired.token);
      } catch (error) {
        const message = error instanceof Error ? error.message : '配对成功，但读取文件列表失败，请重试';
        setState((prev) => sessionAfterPairFailure(prev, code, message));
        return false;
      }
    }

    persistCode(storageRef.current, code);
    persistToken(storageRef.current, paired.token);
    setState((prev) => sessionAfterPair(prev, code, paired.token));
    return true;
  }, [api]);

  const rotatePairing = useCallback(async () => {
    setState((prev) => ({ ...prev, rotating: true, codeError: '' }));
    try {
      const code = await rotatePairingCode(api);
      const paired = await exchangePairingCode(code, api);
      persistCode(storageRef.current, code);
      persistToken(storageRef.current, paired.token);
      setState((prev) => sessionAfterRotate(prev, code, paired.token));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '重新生成失败';
      setState((prev) => ({ ...prev, rotating: false, codeError: message }));
      return false;
    }
  }, [api]);

  return {
    ...state,
    status: sessionStatus(state),
    setCodeInput,
    unlock,
    rotatePairing,
    expireToken,
    acceptConnectedToken,
  };
}

export { TOKEN_STORAGE_KEY };
