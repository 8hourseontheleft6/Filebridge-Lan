/**
 * Download controller.
 *
 * Owns desktop save state (active copy, saving id, batch flag, saved paths),
 * the `download-progress` subscription and browser download triggers. All
 * Tauri commands go through platform/tauri, download URLs through filesApi.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { fileDownloadUrl } from '../../api/filesApi';
import { makeTransferId } from '../../lib/transferId';
import { tauri } from '../../platform/tauri';
import {
  listenTauriEvent,
  type UnlistenFn,
} from '../../platform/tauriEvents';
import type { HubFile } from '../files/types';
import {
  batchSavedToast,
  browserBatchToast,
  mapSaveError,
  savedToast,
} from './downloadService';
import type {
  ActiveDownload,
  DownloadToast,
  SaveOutcome,
} from './types';

export interface DownloadControllerOptions {
  desktop: boolean;
  token: string;
  onToast: (toast: DownloadToast) => void;
}

export interface DownloadController {
  activeDownload: ActiveDownload | null;
  savingId: string | null;
  batchSaving: boolean;
  savedPaths: Record<string, string>;
  saveFile(file: HubFile): Promise<void>;
  saveSelected(files: HubFile[]): Promise<void>;
  cancelDownload(): void;
  openPath(path: string): void;
  openDownloadDir(): void;
  downloadUrl(file: HubFile): string;
}

export function useDownloadController({
  desktop,
  token,
  onToast,
}: DownloadControllerOptions): DownloadController {
  const [activeDownload, setActiveDownload] = useState<ActiveDownload | null>(null);
  const activeRef = useRef(activeDownload);
  activeRef.current = activeDownload;
  const [savingId, setSavingId] = useState<string | null>(null);
  const savingRef = useRef(savingId);
  savingRef.current = savingId;
  const [batchSaving, setBatchSaving] = useState(false);
  const batchRef = useRef(batchSaving);
  batchRef.current = batchSaving;
  const [savedPaths, setSavedPaths] = useState<Record<string, string>>({});

  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;

  const saveOne = useCallback(
    async (file: HubFile): Promise<SaveOutcome> => {
      if (!desktop) return { kind: 'error', message: '当前环境不支持保存到磁盘' };
      const transferId = makeTransferId();
      setActiveDownload({
        transferId,
        name: file.name,
        loaded: 0,
        total: file.size,
        startedAt: Date.now(),
        status: 'copying',
      });
      setSavingId(file.id);
      try {
        const result = await tauri.saveDownload(file.id, transferId);
        setSavedPaths((prev) => ({ ...prev, [file.id]: result.path }));
        return { kind: 'saved', result };
      } catch (reason) {
        return mapSaveError(reason);
      } finally {
        setSavingId(null);
        setActiveDownload(null);
      }
    },
    [desktop],
  );

  const saveFile = useCallback(
    async (file: HubFile) => {
      if (!desktop || savingRef.current || batchRef.current) return;
      const outcome = await saveOne(file);
      if (outcome.kind === 'saved') {
        onToastRef.current(savedToast(outcome.result));
      } else if (outcome.kind === 'cancelled') {
        onToastRef.current({ text: '已取消保存', kind: 'info' });
      } else {
        onToastRef.current({ text: outcome.message, kind: 'error' });
      }
    },
    [desktop, saveOne],
  );

  const saveSelected = useCallback(
    async (targets: HubFile[]) => {
      if (targets.length === 0) return;
      if (savingRef.current || batchRef.current) return;

      if (!desktop) {
        targets.forEach((file, index) => {
          window.setTimeout(() => {
            const anchor = document.createElement('a');
            anchor.href = fileDownloadUrl(file.id, token);
            anchor.download = file.name;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
          }, index * 350);
        });
        onToastRef.current(browserBatchToast(targets.length));
        return;
      }

      batchRef.current = true;
      setBatchSaving(true);
      let completed = 0;
      try {
        for (const file of targets) {
          const outcome = await saveOne(file);
          if (outcome.kind === 'saved') {
            if (outcome.result.path) completed += 1;
          } else {
            onToastRef.current({ text: outcome.message, kind: 'error' });
            return;
          }
        }
        onToastRef.current(batchSavedToast(completed, targets.length));
      } finally {
        batchRef.current = false;
        setBatchSaving(false);
      }
    },
    [desktop, saveOne, token],
  );

  const cancelDownload = useCallback(() => {
    const current = activeRef.current;
    if (!current || current.status === 'cancelling') return;
    setActiveDownload((prev) => (prev ? { ...prev, status: 'cancelling' } : prev));
    void tauri.cancelDownload(current.transferId).catch((reason) => {
      onToastRef.current({ text: `取消失败：${String(reason)}`, kind: 'error' });
    });
  }, []);

  const openPath = useCallback(
    (path: string) => {
      if (!desktop) return;
      void tauri.openPath(path).catch((reason) => {
        onToastRef.current({ text: `打开文件夹失败：${String(reason)}`, kind: 'error' });
      });
    },
    [desktop],
  );

  const openDownloadDir = useCallback(() => {
    if (!desktop) return;
    void tauri.openDownloadDir().catch((reason) => {
      onToastRef.current({ text: `打开下载文件夹失败：${String(reason)}`, kind: 'error' });
    });
  }, [desktop]);

  const downloadUrl = useCallback(
    (file: HubFile) => fileDownloadUrl(file.id, token),
    [token],
  );

  useEffect(() => {
    if (!desktop) return;
    let unlisten: UnlistenFn | undefined;
    let disposed = false;

    void listenTauriEvent('download-progress', (payload) => {
      if (payload.status === 'cancelled' || payload.status === 'failed') return;
      setActiveDownload((prev) => {
        if (!prev || prev.transferId !== payload.transferId) return prev;
        return {
          ...prev,
          loaded: payload.loaded,
          total: payload.total || prev.total,
        };
      });
    })
      .then((dispose) => {
        if (disposed) dispose();
        else unlisten = dispose;
      })
      .catch(() => {
        // 事件监听失败不阻塞下载；命令仍会返回最终结果
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [desktop]);

  return {
    activeDownload,
    savingId,
    batchSaving,
    savedPaths,
    saveFile,
    saveSelected,
    cancelDownload,
    openPath,
    openDownloadDir,
    downloadUrl,
  };
}
