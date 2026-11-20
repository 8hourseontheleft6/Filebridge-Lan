import { useCallback, useEffect, useRef, useState } from 'react';
import { isIosDevice, isTauriHost } from '../platform/runtime';
import { tauri } from '../platform/tauri';
import { listPhoneHosts, resolvePhoneBase } from '../features/network/lanAddress';
import type { LanServiceStatus } from '../features/network/types';
import { useSessionController } from '../features/session/useSessionController';
import { useFilesController } from '../features/files/useFilesController';
import type { HubFile } from '../features/files/types';
import { useUploadController } from '../features/uploads/useUploadController';
import { useDownloadController } from '../features/downloads/useDownloadController';
import type { ActiveDownload } from '../features/downloads/types';
import { useHubConnection } from '../features/connection/useHubConnection';
import type { LiveUpload } from '../features/connection/types';
import { JoinQr } from '../components/JoinQr';
import { InfoTip } from '../components/InfoTip';
import { Icon } from '../components/Icon';
import { FileListCard } from '../components/FileListCard';
import { TransferProgress } from '../components/TransferProgress';
import { PairingDetails } from '../components/PairingDetails';
import { confirmedPercent, shouldShowLiveUpload } from '../lib/uploadOffsets';
import { usePresenceList } from '../lib/usePresence';
import { ConnectPanel } from './ConnectPanel';
import { NearbyComputers } from './NearbyComputers';
import type { NearbyPeer } from '../features/connection/types';
import { ClipboardPanel } from './ClipboardPanel';

interface ToastState {
  text: string;
  kind: 'success' | 'error' | 'info';
  path?: string;
}

function needsSequentialFilePicker(): boolean {
  if (isIosDevice()) return true;
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/(Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Android)/i.test(ua);
}

interface HttpTransferProps {
  lanService?: LanServiceStatus | null;
  networkBlocked?: boolean;
}

export function HttpTransfer({ lanService = null, networkBlocked = false }: HttpTransferProps = {}) {
  const desktop = isTauriHost();
  // The gate either means "real network is Public" or "no real network at all".
  const noUsableNetwork = lanService?.gate === 'no_usable_network';
  const publicPaused = lanService?.gate === 'public_blocked' || noUsableNetwork || networkBlocked;
  const serviceUnavailable = desktop && lanService?.running === false && !publicPaused;
  const [pausedError, setPausedError] = useState('');
  const setOnlineRef = useRef<(value: boolean | null) => void>(() => {});
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [dropLeaving, setDropLeaving] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [refreshSpinning, setRefreshSpinning] = useState(false);
  const refreshSpinTimerRef = useRef<number | null>(null);
  const [peerFrame, setPeerFrame] = useState<NearbyPeer | null>(null);
  const [peerState, setPeerState] = useState<'waiting' | 'connected'>('waiting');
  const peerFrameRef = useRef<HTMLIFrameElement>(null);
  const localBrowser = window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1'
    || window.location.hostname === '::1';
  const autoConnect = new URLSearchParams(window.location.search).get('connect') === '1'
    || (!desktop && !localBrowser);
  const localHubAccess = desktop
    || window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';

  const session = useSessionController({
    desktop,
    localHubAccess,
    onRecovered: () => setOnlineRef.current(true),
  });
  const {
    sessionCode,
    token,
    codeInput,
    codeError,
    sessionReady,
    rotating,
  } = session;

  const filesState = useFilesController({
    token,
    sessionReady,
    onUnauthorized: () => session.expireToken('授权已过期，请重新配对'),
  });
  const {
    files,
    selectedIds,
    batchDeleting,
    allSelected,
  } = filesState;

  const hub = useHubConnection({
    token,
    sessionReady,
    desktop,
    publicPaused,
    serviceUnavailable,
    probeFiles: (timeoutMs) => filesState.refresh({ timeoutMs }).then((result) => result.kind),
    onToast: setToast,
  });
  const { online, setOnline, info, loadInfo, refresh, liveUpload, clearLiveUploadFor } = hub;
  setOnlineRef.current = setOnline;

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const needsPicker = needsSequentialFilePicker();

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleConnectToken = useCallback((newToken: string, expiresAt: number) => {
    session.acceptConnectedToken(newToken, expiresAt);
    setOnline(true);
    setToast({ text: '主机已允许连接', kind: 'success' });
  }, [session.acceptConnectedToken]);

  useEffect(() => {
    if (!peerFrame) return;
    setPeerState('waiting');
    const expectedOrigin = new URL(peerFrame.url).origin;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== peerFrameRef.current?.contentWindow) return;
      if (event.origin !== expectedOrigin) return;
      if (event.data && event.data.type === 'filebridge-peer-connected') {
        setPeerState('connected');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [peerFrame]);

  const uploadsState = useUploadController({
    token,
    onUnauthorized: () => session.expireToken('授权已过期，请重新配对'),
    onRefreshList: refresh,
    onError: setError,
  });
  const { upload, transport, chunkBytes, startUpload, resumeUpload, cancelUpload } = uploadsState;

  const downloads = useDownloadController({
    desktop,
    token,
    onToast: setToast,
  });
  const {
    activeDownload,
    savingId,
    batchSaving,
    savedPaths,
    saveFile: saveFileAction,
    saveSelected: saveSelectedAction,
    cancelDownload,
    openPath,
    openDownloadDir,
    downloadUrl,
  } = downloads;

  // Page-level guards keep the old batch-delete conflict rule; the controller
  // guards its own saving/batch state.
  const saveDownload = useCallback((file: HubFile) => {
    if (batchDeleting) return;
    void saveFileAction(file);
  }, [batchDeleting, saveFileAction]);

  const saveSelected = useCallback(() => {
    if (batchDeleting) return;
    const targets = files.filter((file) => selectedIds.has(file.id));
    if (targets.length === 0) return;
    void saveSelectedAction(targets);
  }, [batchDeleting, files, saveSelectedAction, selectedIds]);

  const spinRefresh = useCallback(() => {
    if (refreshSpinTimerRef.current !== null) window.clearTimeout(refreshSpinTimerRef.current);
    setRefreshSpinning(false);
    // Restart the one-shot spin even when the button is pressed repeatedly.
    window.requestAnimationFrame(() => setRefreshSpinning(true));
    refreshSpinTimerRef.current = window.setTimeout(() => {
      setRefreshSpinning(false);
      refreshSpinTimerRef.current = null;
    }, 620);
  }, []);

  useEffect(() => () => {
    if (refreshSpinTimerRef.current !== null) window.clearTimeout(refreshSpinTimerRef.current);
  }, []);

  useEffect(() => {
    if (!liveUpload || !upload?.uploadId) return;
    if (liveUpload.id === upload.uploadId) clearLiveUploadFor(upload.uploadId);
  }, [clearLiveUploadFor, liveUpload, upload?.uploadId]);

  useEffect(() => {
    if (!upload?.uploadId) return;
    if (upload.status !== 'done' && upload.status !== 'error' && upload.status !== 'cancelled') return;
    clearLiveUploadFor(upload.uploadId);
  }, [clearLiveUploadFor, upload?.status, upload?.uploadId]);

  const openNetworkSettings = useCallback(async () => {
    setPausedError('');
    try {
      await tauri.openExternal('ms-settings:network-wifi');
    } catch (reason) {
      setPausedError(`打开网络设置失败：${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }, []);

  const unlock = useCallback(async () => {
    // The controller owns validation/pairing/persistence; the file probe below
    // may veto the token so a pairing that cannot read files stays uncommitted.
    const unlocked = await session.unlock({
      preCommit: async (pairedToken) => {
        const result = await filesState.probeWithToken(pairedToken);
        if (result.kind !== 'ok') throw new Error('配对成功，但读取文件列表失败，请重试');
      },
    });
    if (unlocked) setOnline(true);
  }, [filesState.probeWithToken, session.unlock]);

  const rotatePairing = useCallback(async () => {
    if (!window.confirm('重新生成配对码会使所有手机连接失效，确定继续？')) return;
    const rotated = await session.rotatePairing();
    if (rotated) filesState.reset();
  }, [filesState.reset, session.rotatePairing]);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const selected = Array.from(fileList);
    if (selected.length === 0) return;
    if (online === false) {
      setError(desktop
        ? 'HTTP Hub 未启动，请先确认电脑端服务在线'
        : '主机服务不可用，主机可能已切换到公用网络或关闭了应用');
      return;
    }
    await startUpload(selected);
  }, [desktop, online, startUpload]);

  const selectFiles = useCallback((fileList: FileList | File[]) => {
    const selected = Array.from(fileList);
    if (selected.length === 0) return;
    if (online === false) {
      setError(desktop
        ? 'HTTP Hub 未启动，请先确认电脑端服务在线'
        : '主机服务不可用，主机可能已切换到公用网络或关闭了应用');
      return;
    }
    if (needsPicker && (selected.length === 1 || pendingFiles.length > 0)) {
      setPendingFiles((prev) => [...prev, ...selected]);
      setError('');
      return;
    }
    void handleFiles(selected);
  }, [desktop, handleFiles, needsPicker, online, pendingFiles.length]);

  const uploadPending = useCallback(() => {
    if (pendingFiles.length === 0) return;
    const selected = pendingFiles;
    setPendingFiles([]);
    void handleFiles(selected);
  }, [handleFiles, pendingFiles]);

  const deleteFile = useCallback(async (id: string) => {
    if (!window.confirm('确定从电脑上删除这个文件？')) return;
    const result = await filesState.deleteOne(id);
    if (result.kind === 'unauthorized') {
      session.expireToken('授权已过期，请在“连接详情”里重新配对');
      return;
    }
    if (result.kind === 'error') {
      setError(result.message);
      return;
    }
    await refresh();
  }, [filesState.deleteOne, refresh, session.expireToken]);

  const deleteSelected = useCallback(async () => {
    if (batchDeleting || batchSaving || selectedIds.size === 0) return;
    const targets = files.filter((file) => selectedIds.has(file.id));
    if (targets.length === 0) return;
    if (!window.confirm(`确定从电脑上删除 ${targets.length} 个文件？此操作不可恢复。`)) return;

    const result = await filesState.deleteSelected();
    if (result.kind === 'skipped') return;
    if (result.kind === 'unauthorized') {
      session.expireToken('授权已过期，请在“连接详情”里重新配对');
      return;
    }
    if (result.kind === 'ok') {
      setToast({ text: `已删除 ${result.deleted}/${result.total} 个文件`, kind: 'success' });
    } else {
      setToast({ text: result.message, kind: 'error' });
    }
    await refresh();
  }, [batchDeleting, batchSaving, files, filesState.deleteSelected, refresh, selectedIds, session.expireToken]);

  const toggleSelected = filesState.toggleSelected;

  const toggleSelectAll = filesState.toggleAll;

  // Files can be dropped anywhere in the window; the list itself is not a drop target.
  useEffect(() => {
    let depth = 0;
    let overlayState: 'hidden' | 'shown' | 'leaving' = 'hidden';
    let overlayTimer: number | null = null;
    const showOverlay = () => {
      if (overlayTimer !== null) {
        window.clearTimeout(overlayTimer);
        overlayTimer = null;
      }
      if (overlayState === 'shown') return;
      overlayState = 'shown';
      setDragging(true);
      setDropLeaving(false);
    };
    const hideOverlay = () => {
      if (overlayState !== 'shown') return;
      overlayState = 'leaving';
      setDropLeaving(true);
      overlayTimer = window.setTimeout(() => {
        overlayState = 'hidden';
        setDragging(false);
        setDropLeaving(false);
        overlayTimer = null;
      }, 160);
    };
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes('Files');
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      if (online !== false) showOverlay();
    };
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = online === false ? 'none' : 'copy';
      if (online !== false) showOverlay();
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) hideOverlay();
    };
    const onDrop = (event: DragEvent) => {
      depth = 0;
      hideOverlay();
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (online === false) return;
      const dropped = event.dataTransfer?.files;
      if (dropped && dropped.length > 0) void handleFiles(dropped);
    };
    const onDragEnd = () => {
      depth = 0;
      hideOverlay();
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', onDragEnd);
    return () => {
      if (overlayTimer !== null) window.clearTimeout(overlayTimer);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', onDragEnd);
    };
  }, [handleFiles, online]);

  const phoneBase = resolvePhoneBase(info);
  const phoneUrl = phoneBase && sessionCode
    ? `${phoneBase}/#code=${encodeURIComponent(sessionCode)}`
    : '';
  // When several real LAN addresses exist, show the alternatives instead of
  // silently depending on the first one.
  const phoneAlternates = listPhoneHosts(info?.ips).slice(1);
  const isViteDev = window.location.port === '5173';
  const uploadTotalBytes = upload?.batchTotal ?? upload?.total ?? 0;
  const uploadConfirmedOffset = upload?.confirmedOffset ?? upload?.offset ?? 0;
  const uploadInFlightOffset = upload?.inFlightLoaded ?? upload?.loaded ?? uploadConfirmedOffset;
  const uploadLoadedBytes = upload
    ? Math.min(uploadTotalBytes, (upload.batchBase || 0) + uploadConfirmedOffset)
    : 0;
  const uploadInFlightBytes = upload
    ? Math.min(uploadTotalBytes, (upload.batchBase || 0) + uploadInFlightOffset)
    : 0;
  const uploadIsBatch = Boolean(upload && (upload.batchCount || 1) > 1);
  const uploadPercent = uploadTotalBytes > 0
    ? confirmedPercent(uploadLoadedBytes, uploadTotalBytes)
    : (upload?.status === 'done' ? 100 : 0);
  const uploadElapsed = upload && (upload.status === 'uploading' || upload.status === 'retrying')
    ? Math.max(0.001, (Date.now() - (upload.batchStartedAt || upload.startedAt)) / 1000)
    : 0;
  const uploadSpeed = uploadElapsed > 0 ? uploadInFlightBytes / uploadElapsed : 0;
  const uploadEta = uploadSpeed > 0 ? Math.max(0, (uploadTotalBytes - uploadLoadedBytes) / uploadSpeed) : 0;
  const uploadDiagnostic = upload ? {
    mode: transport,
    chunkBytes,
    fileSize: upload.total,
    batchIndex: upload.batchIndex,
    batchCount: upload.batchCount,
    browserSent: uploadInFlightBytes,
    requestPhase: upload.requestPhase ?? null,
    serverConfirmed: uploadLoadedBytes,
    serverBodyRead: upload.serverDiag?.bodyRead ?? null,
    serverPartSize: upload.serverDiag?.partSize ?? null,
    serverBodyState: upload.serverDiag?.bodyState ?? null,
    serverLastError: upload.serverDiag?.lastError ?? null,
    contentLength: upload.serverDiag?.contentLength ?? null,
    transferEncoding: upload.serverDiag?.transferEncoding ?? null,
    expect: upload.serverDiag?.expect ?? null,
    serverStatusCode: upload.serverDiag?.statusCode ?? null,
    durationMs: upload.serverDiag?.durationMs ?? null,
    status: upload.status,
    error: upload.error ?? null,
  } : null;
  const downloadPercent = activeDownload
    ? (activeDownload.total > 0
      ? Math.min(100, Math.round((activeDownload.loaded / activeDownload.total) * 100))
      : (activeDownload.loaded > 0 ? 100 : 0))
    : 0;
  const downloadElapsed = activeDownload
    ? Math.max(0.001, (Date.now() - activeDownload.startedAt) / 1000)
    : 0;
  const downloadSpeed = activeDownload && downloadElapsed > 0
    ? activeDownload.loaded / downloadElapsed
    : 0;
  const downloadEta = activeDownload && downloadSpeed > 0
    ? Math.max(0, (activeDownload.total - activeDownload.loaded) / downloadSpeed)
    : 0;
  const visibleLiveUpload = shouldShowLiveUpload(upload?.uploadId, liveUpload?.id)
    ? liveUpload
    : null;
  const showLiveUpload = Boolean(visibleLiveUpload);
  const livePercent = visibleLiveUpload
    ? (visibleLiveUpload.total > 0
      ? Math.min(100, Math.round((visibleLiveUpload.loaded / visibleLiveUpload.total) * 100))
      : (visibleLiveUpload.loaded > 0 ? 100 : 0))
    : 0;
  const liveElapsed = visibleLiveUpload
    ? Math.max(0.001, (Date.now() - visibleLiveUpload.startedAt) / 1000)
    : 0;
  const liveSpeed = visibleLiveUpload && liveElapsed > 0 ? visibleLiveUpload.loaded / liveElapsed : 0;
  const liveEta = visibleLiveUpload && liveSpeed > 0
    ? Math.max(0, (visibleLiveUpload.total - visibleLiveUpload.loaded) / liveSpeed)
    : 0;

  const effectiveUploadSpeed = upload && (upload.status === 'uploading' || upload.status === 'retrying')
    ? Math.max(uploadSpeed, showLiveUpload ? liveSpeed : 0)
    : showLiveUpload
      ? liveSpeed
      : 0;
  const effectiveDownloadSpeed = activeDownload ? downloadSpeed : 0;
  const [uploadPeak, setUploadPeak] = useState(0);
  const [downloadPeak, setDownloadPeak] = useState(0);
  const [shownUploadSpeed, setShownUploadSpeed] = useState(0);
  const [shownDownloadSpeed, setShownDownloadSpeed] = useState(0);
  const [uploadHistory, setUploadHistory] = useState<number[]>(() => Array(24).fill(0));
  const [downloadHistory, setDownloadHistory] = useState<number[]>(() => Array(24).fill(0));
  const [uploadTotal, setUploadTotal] = useState(0);
  const [downloadTotal, setDownloadTotal] = useState(0);
  const uploadSpeedRef = useRef(0);
  const downloadSpeedRef = useRef(0);
  const uploadMeterRef = useRef<{ key: number; loaded: number }>({ key: -1, loaded: 0 });
  const liveMeterRef = useRef<{ key: string; loaded: number }>({ key: '', loaded: 0 });
  const downloadMeterRef = useRef<{ key: string; loaded: number }>({ key: '', loaded: 0 });
  uploadSpeedRef.current = effectiveUploadSpeed;
  downloadSpeedRef.current = effectiveDownloadSpeed;

  // Rows and blocks keep their slot for one exit transition instead of snapping.
  const fileRows = usePresenceList(files, (file) => file.id);
  const liveBlockRef = useRef<LiveUpload | null>(null);
  const saveBlockRef = useRef<ActiveDownload | null>(null);
  useEffect(() => {
    if (visibleLiveUpload) liveBlockRef.current = visibleLiveUpload;
  }, [visibleLiveUpload]);
  useEffect(() => {
    if (activeDownload) saveBlockRef.current = activeDownload;
  }, [activeDownload]);
  const downloadBlocks = usePresenceList(
    [
      ...(showLiveUpload && visibleLiveUpload ? ['receive'] : []),
      ...(activeDownload ? ['save'] : []),
    ],
    (key) => key,
  );
  // The upload readout leaves once the upload is done, but stays for a moment so
  // the finished state is readable instead of vanishing under the cursor.
  const [uploadHolding, setUploadHolding] = useState(false);
  useEffect(() => {
    if (upload?.status !== 'done') {
      setUploadHolding(false);
      return;
    }
    setUploadHolding(true);
    const timer = window.setTimeout(() => setUploadHolding(false), 1600);
    return () => window.clearTimeout(timer);
  }, [upload?.status]);
  const uploadBlocks = usePresenceList(
    upload && (upload.status !== 'done' || uploadHolding) ? ['upload'] : [],
    (key) => key,
  );
  const hasActiveTransfer = Boolean(uploadBlocks.length > 0 || visibleLiveUpload || activeDownload);

  useEffect(() => {
    if (!upload) return;
    if (uploadMeterRef.current.key !== upload.startedAt) {
      uploadMeterRef.current = { key: upload.startedAt, loaded: 0 };
    }
    const delta = Math.max(0, upload.loaded - uploadMeterRef.current.loaded);
    if (delta > 0) setUploadTotal((value) => value + delta);
    uploadMeterRef.current.loaded = upload.loaded;
  }, [upload]);

  useEffect(() => {
    if (!visibleLiveUpload || (upload && upload.status === 'uploading')) return;
    if (liveMeterRef.current.key !== visibleLiveUpload.id) {
      liveMeterRef.current = { key: visibleLiveUpload.id, loaded: 0 };
    }
    const delta = Math.max(0, visibleLiveUpload.loaded - liveMeterRef.current.loaded);
    if (delta > 0) setUploadTotal((value) => value + delta);
    liveMeterRef.current.loaded = visibleLiveUpload.loaded;
  }, [visibleLiveUpload, upload]);

  useEffect(() => {
    if (!activeDownload) return;
    if (downloadMeterRef.current.key !== activeDownload.transferId) {
      downloadMeterRef.current = { key: activeDownload.transferId, loaded: 0 };
    }
    const delta = Math.max(0, activeDownload.loaded - downloadMeterRef.current.loaded);
    if (delta > 0) setDownloadTotal((value) => value + delta);
    downloadMeterRef.current.loaded = activeDownload.loaded;
  }, [activeDownload]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const up = uploadSpeedRef.current;
      const down = downloadSpeedRef.current;
      setShownUploadSpeed(up);
      setShownDownloadSpeed(down);
      setUploadPeak((value) => Math.max(value, up));
      setDownloadPeak((value) => Math.max(value, down));
      setUploadHistory((values) => [...values.slice(-23), up]);
      setDownloadHistory((values) => [...values.slice(-23), down]);
    }, 400);
    return () => window.clearInterval(timer);
  }, []);

  const canRotate = desktop
    || window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  const statusLabel = publicPaused
    ? '网络暂停'
    : !sessionReady
      ? '读取中'
      : online === null
        ? '连接中'
        : online === false
          ? (desktop ? '服务异常' : '无法连接')
          : !token
            ? (codeError ? '授权已过期' : '需要配对')
            : '在线';
  const statusClass = statusLabel === '在线'
    ? 'chip-ok'
    : statusLabel === '网络暂停'
      ? 'chip-warn'
      : statusLabel === '服务异常'
        || statusLabel === '无法连接'
        || statusLabel === '授权已过期'
        ? 'chip-bad'
        : 'chip-warn';

  const pairingExpanded = token ? pairingOpen : true;

  const pairingDetails = (
    <PairingDetails
      sessionCode={sessionCode}
      codeInput={codeInput}
      codeError={codeError}
      canRotate={canRotate}
      rotating={rotating}
      expanded={pairingExpanded}
      onToggle={() => setPairingOpen((value) => !value)}
      onCodeInput={(value) => session.setCodeInput(value)}
      onUnlock={() => void unlock()}
      onRotate={() => void rotatePairing()}
    />
  );

  const serviceNotice = desktop && online === false && !publicPaused ? (
    <div className="notice notice-bad">
      <p>
        {desktop
          ? lanService?.running === false
            ? (lanService.detail || '局域网服务未能启动。请检查 TCP 42080 / UDP 42081 是否被占用，或查看下方发现状态后重试。')
            : '电脑端局域网服务异常，暂时无法访问文件页。请重试连接。'
          : '无法连接电脑端服务。请确认运行 Filebridge-Lan 的电脑已启动，并与当前设备在同一局域网。'}
      </p>
      <button
        type="button"
        className="btn btn-small"
        onClick={() => {
          setOnline(null);
          void loadInfo();
          void refresh();
        }}
      >
        重试连接
      </button>
    </div>
  ) : null;

  if (publicPaused) {
    return (
      <div className="lan-dashboard">
        <article className="card lan-paused-card">
          <h2>
            {noUsableNetwork
              ? '没有可用的真实网络，局域网传输服务已暂停。'
              : '当前网络为公用网络，局域网传输服务已暂停。'}
          </h2>
          <p className="lan-paused-copy">
            {noUsableNetwork
              ? '只检测到虚拟网卡或没有已连接的真实 Wi-Fi / 以太网。Filebridge 只绑定真实网卡，连接真实网络后会自动恢复。'
              : '切换到专用网络后将自动恢复，不会在 Public 网络开放 42080/42081。'}
          </p>
          <div className="lan-paused-meta">
            <span className={`status-pill ${token ? 'warn' : 'warn'}`}>
              {token ? '已配对 · 当前不可连接' : '未配对 · 当前不可连接'}
            </span>
          </div>
          <div className="lan-paused-actions">
            <button type="button" className="btn btn-primary" onClick={() => void openNetworkSettings()}>
              前往网络设置
            </button>
          </div>
          {pausedError && <p className="text-error" role="alert">{pausedError}</p>}
          <p className="hint">
            局域网 IP、扫码和手动配对码仅在专用网络下可用。
          </p>
        </article>
      </div>
    );
  }

  if (!sessionReady) {
    return (
      <div className="lan-dashboard">
        <article className="card loading-card">
          <span className="loading-dot" />
          <div>
            <h2>正在读取连接状态</h2>
            <p>稍等片刻，正在确认本机 Hub 和配对状态。</p>
          </div>
        </article>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="lan-dashboard">
        <div className="dashboard-grid single">
          <article className="card connection-card">
            <div className="card-head">
              <div>
                <h2>
                  连接这台电脑
                  <InfoTip text="扫码通常会自动配对；失败时可手动输入 6 位配对码。也可以直接请求主机确认，无需输入配对码。" />
                </h2>
              </div>
              <span className={`status-pill ${codeError ? 'danger' : 'warn'}`}>
                {codeError ? '授权已过期' : '需要配对'}
              </span>
            </div>
            {serviceNotice}
            <ConnectPanel autoConnect={autoConnect} onConnected={handleConnectToken} />
            {pairingDetails}
          </article>
        </div>
      </div>
    );
  }

  return (
    <div className={`lan-dashboard${desktop ? ' has-nearby' : ''}`}>
      {!desktop && online === false && (
        <div className="notice notice-bad remote-offline" role="alert">
          <div>
            <strong>主机服务不可用</strong>
            <p>主机可能已切换到公用网络或关闭了应用。当前文件列表是离线缓存，可能已过期。</p>
          </div>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              setOnline(null);
              void loadInfo();
              void refresh();
            }}
          >
            重新连接
          </button>
        </div>
      )}
      <div className="dashboard-grid">

        <FileListCard
          files={files}
          fileRows={fileRows}
          selectedIds={selectedIds}
          allSelected={allSelected}
          online={online}
          desktop={desktop}
          needsPicker={needsPicker}
          pendingFiles={pendingFiles}
          refreshSpinning={refreshSpinning}
          error={error}
          savingId={savingId}
          batchSaving={batchSaving}
          batchDeleting={batchDeleting}
          savedPaths={savedPaths}
          onSelectFiles={selectFiles}
          onUploadPending={uploadPending}
          onClearPending={() => setPendingFiles([])}
          onSaveSelected={saveSelected}
          onDeleteSelected={() => void deleteSelected()}
          onToggleAll={toggleSelectAll}
          onRefresh={() => { spinRefresh(); void refresh(); }}
          onOpenDownloadDir={openDownloadDir}
          onToggleSelected={toggleSelected}
          onSaveFile={(file) => void saveDownload(file)}
          onOpenPath={openPath}
          onDeleteFile={(id) => void deleteFile(id)}
          downloadUrl={downloadUrl}
          onBrowserDownload={() => setToast({ text: '已开始下载，请查看浏览器下载列表', kind: 'info' })}
        />

        <TransferProgress
          upload={upload}
          uploadBlocks={uploadBlocks}
          uploadIsBatch={uploadIsBatch}
          uploadPercent={uploadPercent}
          uploadLoadedBytes={uploadLoadedBytes}
          uploadTotalBytes={uploadTotalBytes}
          uploadEta={uploadEta}
          uploadHistory={uploadHistory}
          shownUploadSpeed={shownUploadSpeed}
          uploadPeak={uploadPeak}
          uploadTotal={uploadTotal}
          downloadBlocks={downloadBlocks}
          activeDownload={activeDownload}
          visibleLiveUpload={visibleLiveUpload}
          liveFallback={liveBlockRef.current}
          saveFallback={saveBlockRef.current}
          livePercent={livePercent}
          liveEta={liveEta}
          downloadPercent={downloadPercent}
          downloadEta={downloadEta}
          downloadHistory={downloadHistory}
          shownDownloadSpeed={shownDownloadSpeed}
          downloadPeak={downloadPeak}
          downloadTotal={downloadTotal}
          hasActiveTransfer={hasActiveTransfer}
          onCancelUpload={cancelUpload}
          onResumeUpload={resumeUpload}
          onCancelDownload={cancelDownload}
        />

        <article className="card connection-card">
          <div className="card-head">
            <div>
              <h2>{desktop ? '扫码连接' : '连接状态'}</h2>
              {desktop && <p>同一 WiFi 下，手机扫码即可打开。</p>}
            </div>
            <span className={`status-pill ${statusClass === 'chip-ok' ? 'ok' : statusClass === 'chip-bad' ? 'danger' : 'warn'}`}>
              {statusLabel}
            </span>
          </div>

          {serviceNotice}

          {!desktop && token && (
            <p className="connected-phone-line">已连接 {window.location.host}</p>
          )}

          {desktop && online === true && (
            phoneUrl ? (
              <>
                <JoinQr
                  url={phoneUrl}
                  displayUrl={showCode ? phoneUrl : phoneUrl.replace(/([?&#]code=)\d{6}/, '$1••••••')}
                  title="手机扫码打开"
                  actions={(
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon-round"
                      aria-pressed={showCode}
                      aria-label={showCode ? '隐藏 code' : '显示 code'}
                      title={showCode ? '隐藏 code' : '显示 code'}
                      onClick={() => setShowCode((value) => !value)}
                    >
                      <Icon name={showCode ? 'eye-off' : 'eye'} size={15} />
                    </button>
                  )}
                />
                {phoneAlternates.length > 0 && (
                  <p className="hint">
                    其它可用地址（二维码无法打开时手动输入）：
                    {phoneAlternates
                      .map((host) => `http://${host}:${info?.port || 42080}`)
                      .join(' · ')}
                  </p>
                )}
              </>
            ) : (
              <p className="hint">
                {sessionCode
                  ? '未检测到局域网 IP，请确认电脑已连接 WiFi/网线后刷新。'
                  : '已通过主机确认连接。'}
              </p>
            )
          )}

          {desktop && pairingDetails}
        </article>

        <NearbyComputers
          onConnect={setPeerFrame}
          activePeerId={peerFrame?.id}
          activeState={peerState}
        />

        <ClipboardPanel
          token={token}
          desktop={desktop}
          online={online}
          publicPaused={publicPaused}
        />


      </div>


      {dragging && (
        <div className={`drop-overlay${dropLeaving ? ' is-leaving' : ''}`} role="status">
          <div className="drop-overlay-card">
            <span className="drop-overlay-icon" aria-hidden><Icon name="plus" size={20} /></span>
            <strong>松开即可上传</strong>
            <span>窗口任意位置都可以放下文件</span>
          </div>
        </div>
      )}

      {peerFrame && (
        <div className="peer-frame-overlay">
          <header className="peer-frame-head">
            <div>
              <strong>正在连接 {peerFrame.name}</strong>
              <span>{peerFrame.ip}:{peerFrame.port}</span>
            </div>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setPeerFrame(null)}>
              关闭
            </button>
          </header>
          <iframe
            ref={peerFrameRef}
            className="peer-frame"
            src={`${peerFrame.url}?connect=1`}
            title={`连接 ${peerFrame.name}`}
          />
        </div>
      )}

      {toast && (
        <div className={`toast toast-${toast.kind}`} role="status">
          <span className="toast-text">{toast.text}</span>
          {toast.path && (
            <button type="button" className="toast-action" onClick={() => openPath(toast.path!)}>
              打开
            </button>
          )}
          <button type="button" className="toast-close" onClick={() => setToast(null)} aria-label="关闭提示">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {online === true && isViteDev && (
        <p className="hint vite-hint">当前页面来自 Vite；生产环境可直接用上面的 Hub 地址访问。</p>
      )}
    </div>
  );
}
