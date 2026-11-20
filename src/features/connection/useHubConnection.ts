/**
 * Hub connection controller.
 *
 * Owns the online/offline state, the `/api/info` probe and the SSE lifecycle
 * (heartbeat watchdog + receive-only upload events). The page supplies the
 * files-list probe and a toast sink; all HTTP/EventSource details stay in
 * `api/*` and this controller.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { fileEventsUrl } from '../../api/filesApi';
import { getHubInfoOrNull, type HubInfo } from '../../api/infoApi';
import {
  ConnectionMonitor,
  HEARTBEAT_STALE_MS,
  PROBE_TIMEOUT_MS,
  isHeartbeatStale,
} from '../../lib/connectionMonitor';
import { parseUploadEvent } from './hubEventService';
import type { HubProbeKind, HubToast, LiveUpload } from './types';

export interface HubConnectionOptions {
  token: string;
  sessionReady: boolean;
  desktop: boolean;
  publicPaused: boolean;
  serviceUnavailable: boolean;
  /** Files-list probe; `timeoutMs` is the pre-E2 2s budget. */
  probeFiles: (timeoutMs: number) => Promise<HubProbeKind>;
  onToast: (toast: HubToast) => void;
}

export interface HubConnection {
  online: boolean | null;
  setOnline: Dispatch<SetStateAction<boolean | null>>;
  info: HubInfo | null;
  loadInfo: () => Promise<void>;
  refresh: () => Promise<void>;
  liveUpload: LiveUpload | null;
  /** Clear the receive indicator if it still belongs to `uploadId`. */
  clearLiveUploadFor: (uploadId: string) => void;
}

export function useHubConnection({
  token,
  sessionReady,
  desktop,
  publicPaused,
  serviceUnavailable,
  probeFiles,
  onToast,
}: HubConnectionOptions): HubConnection {
  const [online, setOnline] = useState<boolean | null>(null);
  const [info, setInfo] = useState<HubInfo | null>(null);
  const [liveUpload, setLiveUpload] = useState<LiveUpload | null>(null);

  const monitorRef = useRef(new ConnectionMonitor());
  const sseLastEventAtRef = useRef(0);
  const liveUploadEventAtRef = useRef(0);
  const probeRef = useRef(probeFiles);
  probeRef.current = probeFiles;
  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;

  useEffect(() => {
    if (serviceUnavailable) setOnline(false);
  }, [serviceUnavailable]);

  // Probe wrapper: the list itself lives in the files controller; the monitor
  // bookkeeping and online transitions stay here.
  const refresh = useCallback(async () => {
    if (!token || !sessionReady) return;
    const monitor = monitorRef.current;
    if (!monitor.beginProbe()) return;
    const kind = await probeRef.current(PROBE_TIMEOUT_MS);
    if (kind === 'unauthorized') {
      monitor.completeProbe(true);
      return;
    }
    if (kind === 'ok') {
      const wasOffline = monitor.isOnline === false;
      monitor.completeProbe(true);
      if (wasOffline) sseLastEventAtRef.current = Date.now();
      setOnline(true);
      return;
    }
    const outcome = monitor.completeProbe(false);
    if (outcome.changed && outcome.offline) setOnline(false);
  }, [sessionReady, token]);

  const loadInfo = useCallback(async () => {
    const data = await getHubInfoOrNull();
    if (data) {
      setInfo(data);
      setOnline(true);
    } else {
      setOnline(false);
    }
  }, []);

  const clearLiveUploadFor = useCallback((uploadId: string) => {
    setLiveUpload((prev) => {
      if (prev?.id !== uploadId) return prev;
      liveUploadEventAtRef.current = 0;
      return null;
    });
  }, []);

  useEffect(() => {
    if (!online || !token || !sessionReady) return;
    const source = new EventSource(fileEventsUrl(token));
    source.onopen = () => {
      sseLastEventAtRef.current = Date.now();
      monitorRef.current.noteHeartbeat();
      setOnline(true);
    };
    source.onerror = () => {
      // EventSource reconnects automatically, but do not wait for the user to
      // try an upload. Probe immediately; the heartbeat watchdog will mark the
      // host offline if the stream stays silent.
      sseLastEventAtRef.current = 0;
      void refresh();
    };
    const onHeartbeat = () => {
      sseLastEventAtRef.current = Date.now();
      monitorRef.current.noteHeartbeat();
    };
    const onUpload = (event: Event) => {
      sseLastEventAtRef.current = Date.now();
      monitorRef.current.noteHeartbeat();
      const data = parseUploadEvent((event as MessageEvent).data);
      if (!data) return;
      if (data.status === 'started' || data.status === 'progress') {
        liveUploadEventAtRef.current = Date.now();
        setLiveUpload((prev) => ({
          id: data.id,
          name: data.name,
          loaded: data.loaded,
          total: data.total || (prev?.id === data.id ? prev.total : 0),
          startedAt: prev?.id === data.id ? prev.startedAt : Date.now(),
        }));
      } else if (data.status === 'completed') {
        liveUploadEventAtRef.current = 0;
        setLiveUpload(null);
        onToastRef.current({ text: `已接收 ${data.name}`, kind: 'success' });
        void refresh();
      } else if (data.status === 'failed') {
        liveUploadEventAtRef.current = 0;
        setLiveUpload(null);
        onToastRef.current({ text: `接收失败：${data.name}`, kind: 'error' });
      }
    };
    source.addEventListener('upload', onUpload);
    source.addEventListener('heartbeat', onHeartbeat);
    return () => {
      source.removeEventListener('upload', onUpload);
      source.removeEventListener('heartbeat', onHeartbeat);
      source.close();
    };
  }, [online, refresh, sessionReady, token]);

  useEffect(() => {
    if (!token || !sessionReady || online !== true) return;
    const timer = window.setInterval(() => {
      if (!isHeartbeatStale(sseLastEventAtRef.current, Date.now(), HEARTBEAT_STALE_MS)) return;
      const outcome = monitorRef.current.heartbeatTimedOut();
      if (outcome.changed) setOnline(false);
      void refresh();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [online, refresh, sessionReady, token]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (liveUploadEventAtRef.current && Date.now() - liveUploadEventAtRef.current > 5000) {
        liveUploadEventAtRef.current = 0;
        setLiveUpload(null);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Public pause is a security state, not a service failure. When the gate opens
  // again, re-probe the Hub instead of showing a stale "service unavailable" card.
  useEffect(() => {
    if (publicPaused || !sessionReady || !desktop) return;
    void loadInfo();
  }, [desktop, loadInfo, publicPaused, sessionReady]);

  useEffect(() => {
    if (publicPaused || !desktop || online !== false) return;
    const timer = window.setInterval(() => {
      void loadInfo();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [desktop, loadInfo, online, publicPaused]);

  useEffect(() => {
    void loadInfo();
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [loadInfo, refresh]);

  return {
    online,
    setOnline,
    info,
    loadInfo,
    refresh,
    liveUpload,
    clearLiveUploadFor,
  };
}
