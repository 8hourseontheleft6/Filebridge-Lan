/**
 * Outgoing connect-request controller ("request host approval").
 *
 * Owns the pending request (sessionStorage hand-off), the 1.2 s status poll,
 * the 60 s countdown and the phase transitions. requestSecret never leaves this
 * device: it is only sent in the X-Connect-Secret header by the connection API.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { createConnectRequest, getConnectStatus, type ConnectRequestCreated } from '../../api/connectionApi';
import {
  CONNECT_STATUS_POLL_MS,
  clearPendingRequest,
  connectOutcome,
  connectStatusError,
  deviceDisplayName,
  readPendingRequest,
  remainingSeconds,
  savePendingRequest,
} from './connectionService';
import type { ConnectPhase } from './types';

export interface ConnectRequestController {
  phase: ConnectPhase;
  error: string;
  remaining: number;
  deviceName: string;
  waiting: boolean;
  failed: boolean;
  start(): Promise<void>;
}

function sessionStorageSafe(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function useConnectRequest(
  onConnected: (token: string, expiresAt: number) => void,
  autoConnect = false,
): ConnectRequestController {
  const [phase, setPhase] = useState<ConnectPhase>('idle');
  const [request, setRequest] = useState<ConnectRequestCreated | null>(null);
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState(60);
  const stoppedRef = useRef(false);
  const autoStartedRef = useRef(false);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  useEffect(() => {
    if (!request || phase !== 'waiting') return;
    const storage = sessionStorageSafe();
    let active = true;
    stoppedRef.current = false;

    const check = async () => {
      if (!active || stoppedRef.current) return;
      try {
        const status = await getConnectStatus(request);
        if (!active) return;
        const outcome = connectOutcome(status);
        if (outcome.clearPending && storage) clearPendingRequest(storage);
        if (outcome.phase === 'idle' && outcome.token) {
          setPhase('idle');
          stoppedRef.current = true;
          onConnectedRef.current(outcome.token, outcome.expiresAt || 0);
          return;
        }
        if (outcome.phase !== 'waiting') {
          setPhase(outcome.phase);
          if (outcome.error) setError(outcome.error);
          stoppedRef.current = true;
        }
      } catch (reason) {
        if (!active) return;
        const failure = connectStatusError(reason);
        if (failure.clearPending && storage) clearPendingRequest(storage);
        setPhase('error');
        setError(failure.message);
        stoppedRef.current = true;
      }
    };

    void check();
    const timer = window.setInterval(() => { void check(); }, CONNECT_STATUS_POLL_MS);
    const countdown = window.setInterval(() => {
      setRemaining((value) => Math.max(0, value - 1));
    }, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.clearInterval(countdown);
    };
  }, [phase, request]);

  const start = useCallback(async () => {
    const storage = sessionStorageSafe();
    const saved = storage ? readPendingRequest(storage) : null;
    if (saved) {
      setRequest(saved);
      setRemaining(Math.max(1, remainingSeconds(saved.expiresAt)));
      setPhase('waiting');
      return;
    }
    setPhase('creating');
    setError('');
    try {
      const created = await createConnectRequest();
      if (storage) savePendingRequest(storage, created);
      setRequest(created);
      setRemaining(Math.max(1, remainingSeconds(created.expiresAt)));
      setPhase('waiting');
    } catch (reason) {
      setPhase('error');
      setError(reason instanceof Error ? reason.message : '创建连接请求失败');
    }
  }, []);

  useEffect(() => {
    if (!autoConnect || autoStartedRef.current) return;
    autoStartedRef.current = true;
    const storage = sessionStorageSafe();
    const saved = storage ? readPendingRequest(storage) : null;
    if (saved) {
      setRequest(saved);
      setRemaining(Math.max(1, remainingSeconds(saved.expiresAt)));
      setPhase('waiting');
      return;
    }
    void start();
  }, [autoConnect, start]);

  const waiting = phase === 'waiting' || phase === 'creating';
  const failed = phase === 'denied' || phase === 'expired' || phase === 'error';
  return { phase, error, remaining, deviceName: deviceDisplayName(), waiting, failed, start };
}
