/**
 * Upload controller.
 *
 * Owns upload state, the transfer id/abort/queue refs and the diagnostics
 * poll. UI only calls `startUpload` / `resumeUpload` / `cancelUpload` and
 * renders `upload`; all chunk/offset logic lives in the service.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  cancelUpload as cancelServerUpload,
  getUploadOffset,
  uploadChunkFetch,
  uploadChunkXhr,
} from '../../api/uploadApi';
import { makeTransferId } from '../../lib/transferId';
import { hasServerFile, resolveServerOffset } from '../../lib/uploadOffsets';
import { isIosDevice } from '../../platform/runtime';
import type { HubFile } from '../files/types';
import {
  IOS_UPLOAD_CHUNK_SIZE,
  UPLOAD_CHUNK_SIZE,
  UploadCancelledError,
  advanceUploadQueue,
  createUploadQueue,
  createUploadState,
  uploadFile,
} from './uploadsService';
import type {
  UploadBatch,
  UploadQueue,
  UploadServerStatus,
  UploadState,
  UploadTransport,
  UploadUpdate,
} from './types';

export interface UploadControllerOptions {
  token: string;
  /** XHR 401: expire the session (the old inline transport did this). */
  onUnauthorized: () => void;
  /** Called after a batch/file completes so the file list can refresh. */
  onRefreshList: () => void | Promise<void>;
  /** Batch-level failure copy (maps to the page's error banner). */
  onError: (message: string) => void;
}

export interface UploadController {
  upload: UploadState | null;
  /** Transport selected for this device (diagnostics display). */
  transport: UploadTransport;
  /** Chunk size for the current device (diagnostics display). */
  chunkBytes: number;
  startUpload(files: File[]): Promise<void>;
  resumeUpload(): void;
  cancelUpload(): void;
}

export function useUploadController({
  token,
  onUnauthorized,
  onRefreshList,
  onError,
}: UploadControllerOptions): UploadController {
  const [upload, setUpload] = useState<UploadState | null>(null);
  const uploadRef = useRef(upload);
  uploadRef.current = upload;
  const cancelRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<UploadQueue | null>(null);

  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  const onRefreshRef = useRef(onRefreshList);
  onRefreshRef.current = onRefreshList;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const update = useCallback((next: UploadUpdate) => {
    setUpload((prev) => {
      if (!prev) return prev;
      const patch = typeof next === 'function' ? next(prev) : next;
      return { ...prev, ...patch };
    });
  }, []);

  const runUpload = useCallback(
    async (
      file: File,
      resume?: { id: string; offset: number },
      batch?: UploadBatch,
    ): Promise<HubFile> => {
      const id = resume?.id || makeTransferId();
      const tokenAtStart = token;
      const abort = new AbortController();
      abortRef.current = abort;
      cancelRef.current = false;
      setUpload(createUploadState(file, id, resume?.offset || 0, batch));

      const transport = isIosDevice() ? 'fetch-blob' : 'xhr-blob';
      const chunkSize = isIosDevice() ? IOS_UPLOAD_CHUNK_SIZE : UPLOAD_CHUNK_SIZE;
      return uploadFile(file, id, resume?.offset || 0, batch, {
        transport,
        chunkSize,
        sendChunk: (chunkFile, uploadId, offset, size, chunkTransport, callbacks) => {
          const request = {
            token: tokenAtStart,
            file: chunkFile,
            uploadId,
            offset,
            chunkSize: size,
            signal: abort.signal,
            onProgress: callbacks.onProgress,
            onPhase: callbacks.onPhase,
          };
          return chunkTransport === 'fetch-blob'
            ? uploadChunkFetch(request)
            : uploadChunkXhr(request);
        },
        queryOffset: (uploadId) => getUploadOffset(tokenAtStart, uploadId),
        isCancelled: () => cancelRef.current,
        onUnauthorized: () => onUnauthorizedRef.current(),
        onUpdate: update,
      });
    },
    [token, update],
  );

  const uploadBatch = useCallback(
    async (
      files: File[],
      startIndex = 0,
      completedBefore = 0,
      resumeCurrent?: { id: string; offset: number },
    ) => {
      if (files.length === 0) return;
      const startedAt = queueRef.current?.startedAt || Date.now();
      const queue = createUploadQueue(files, startIndex, completedBefore, startedAt);
      queueRef.current = queue;
      let completedBytes = completedBefore;
      onErrorRef.current('');

      for (let index = startIndex; index < files.length; index += 1) {
        const file = files[index];
        const resume = index === startIndex ? resumeCurrent : undefined;
        try {
          const saved = await runUpload(file, resume, {
            index: index + 1,
            count: files.length,
            totalBytes: queue.totalBytes,
            baseBytes: completedBytes,
            startedAt,
          });
          completedBytes += saved.size;
          queueRef.current = advanceUploadQueue(queue, index + 1, completedBytes);
        } catch (reason) {
          if (reason instanceof UploadCancelledError) {
            queueRef.current = null;
            update({ status: 'cancelled', error: undefined });
            onErrorRef.current('');
          } else {
            onErrorRef.current(reason instanceof Error ? reason.message : String(reason));
          }
          return;
        }
      }

      queueRef.current = null;
      update((prev) => ({
        loaded: prev.file?.size || prev.loaded,
        inFlightLoaded: prev.file?.size || prev.inFlightLoaded,
        total: prev.file?.size || prev.total,
        status: 'done',
        offset: prev.file?.size || prev.offset,
        confirmedOffset: prev.file?.size || prev.confirmedOffset,
      }));
      await onRefreshRef.current();
    },
    [runUpload, update],
  );

  const startUpload = useCallback(
    (files: File[]) => uploadBatch(files),
    [uploadBatch],
  );

  const resumeUpload = useCallback(() => {
    const current = uploadRef.current;
    if (!current?.file || !current.uploadId) return;
    cancelRef.current = false;
    const file = current.file;
    const uploadId = current.uploadId;
    const queue = queueRef.current;
    update({ status: 'retrying', checking: true, error: undefined });

    void (async () => {
      let status: UploadServerStatus;
      try {
        status = await getUploadOffset(token, uploadId);
      } catch {
        const message = '无法核对服务器已保存进度，请检查连接后重试';
        update({ status: 'error', checking: false, error: message });
        onErrorRef.current(message);
        return;
      }

      if (hasServerFile(status)) {
        const doneOffset = status.offset;
        if (queue && current.file) {
          const nextCompleted = queue.completedBytes + current.file.size;
          const nextIndex = queue.index + 1;
          queueRef.current = advanceUploadQueue(queue, nextIndex, nextCompleted);
          if (nextIndex < queue.files.length) {
            update({
              loaded: current.file.size,
              inFlightLoaded: current.file.size,
              confirmedOffset: current.file.size,
              offset: current.file.size,
              status: 'uploading',
              checking: false,
            });
            await uploadBatch(queue.files, nextIndex, nextCompleted);
            return;
          }
          queueRef.current = null;
        }
        update({
          loaded: doneOffset,
          inFlightLoaded: doneOffset,
          confirmedOffset: doneOffset,
          offset: doneOffset,
          status: 'done',
          checking: false,
        });
        await onRefreshRef.current();
        return;
      }

      const confirmed = resolveServerOffset(
        {
          confirmedOffset: current.confirmedOffset ?? current.offset ?? 0,
          inFlightLoaded: current.inFlightLoaded ?? current.loaded ?? 0,
        },
        status,
      ).confirmedOffset;
      update((prev) => ({
        confirmedOffset: confirmed,
        offset: confirmed,
        loaded: confirmed,
        inFlightLoaded: confirmed,
        serverDiag: status.diagnostics ?? prev.serverDiag,
        checking: false,
      }));

      if (queue) {
        await uploadBatch(queue.files, queue.index, queue.completedBytes, {
          id: uploadId,
          offset: confirmed,
        });
        return;
      }

      const batch = current.batchCount
        ? {
            index: current.batchIndex || 1,
            count: current.batchCount,
            totalBytes: current.batchTotal || current.total,
            baseBytes: current.batchBase || 0,
            startedAt: current.batchStartedAt || current.startedAt,
          }
        : undefined;
      try {
        const saved = await runUpload(file, { id: uploadId, offset: confirmed }, batch);
        update({
          loaded: saved.size,
          inFlightLoaded: saved.size,
          total: saved.size,
          status: 'done',
          offset: saved.size,
          confirmedOffset: saved.size,
        });
        await onRefreshRef.current();
      } catch {
        // upload state carries the failure
      }
    })();
  }, [token, update, uploadBatch, runUpload]);

  const cancelUpload = useCallback(() => {
    cancelRef.current = true;
    queueRef.current = null;
    abortRef.current?.abort();
    const id = uploadRef.current?.uploadId;
    if (id && token) {
      void cancelServerUpload(token, id).catch(() => {});
    }
    update({ status: 'cancelled', error: undefined });
  }, [token, update]);

  const diagnosticsId = upload?.uploadId;
  const diagnosticsStatus = upload?.status;
  useEffect(() => {
    if (!diagnosticsId) return;
    if (diagnosticsStatus !== 'uploading' && diagnosticsStatus !== 'retrying') return;
    const timer = window.setInterval(() => {
      void getUploadOffset(token, diagnosticsId)
        .then((status) => {
          setUpload((prev) =>
            prev && prev.uploadId === diagnosticsId
              ? { ...prev, serverDiag: status.diagnostics ?? prev.serverDiag }
              : prev,
          );
        })
        .catch(() => {
          /* network down; keep the last diagnostic */
        });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [diagnosticsId, diagnosticsStatus, token]);

  return {
    upload,
    transport: isIosDevice() ? 'fetch-blob' : 'xhr-blob',
    chunkBytes: isIosDevice() ? IOS_UPLOAD_CHUNK_SIZE : UPLOAD_CHUNK_SIZE,
    startUpload,
    resumeUpload,
    cancelUpload,
  };
}
