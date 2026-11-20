/**
 * File list controller.
 *
 * Owns the list, the selection and deletion state; all I/O goes through the
 * files service. The page keeps presentation only (confirm dialogs, toasts,
 * the refresh spinner) and the connection monitor wrapper.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  allSelected as computeAllSelected,
  clearSelection as clearSelectionState,
  deleteFileById,
  deleteFiles,
  filesAfterDeleteMissing,
  filesAfterDeleteOne,
  filesAfterRefresh,
  httpFilesApi,
  refreshFiles,
  selectedFiles,
  selectAllFiles,
  toggleAllFiles,
  toggleSelection as toggleSelectionState,
} from './filesService';
import type {
  DeleteManyOutcome,
  DeleteOneResult,
  FilesApiPort,
  FilesRefreshResult,
  FilesState,
  HubFile,
} from './types';

export interface FilesControllerOptions {
  token: string;
  sessionReady: boolean;
  api?: FilesApiPort;
  /** Called when the Hub rejects the token (401/403) so the session can expire. */
  onUnauthorized?: () => void;
}

export interface FilesController {
  files: HubFile[];
  selectedIds: Set<string>;
  batchDeleting: boolean;
  allSelected: boolean;
  refresh(): Promise<FilesRefreshResult>;
  /** Load with a token that is being committed (manual pairing pre-check). */
  probeWithToken(token: string): Promise<FilesRefreshResult>;
  toggleSelected(id: string): void;
  selectAll(): void;
  toggleAll(): void;
  clearSelection(): void;
  /** Drop the list and the selection (pairing code rotation invalidates both). */
  reset(): void;
  deleteOne(id: string): Promise<DeleteOneResult>;
  deleteSelected(): Promise<DeleteManyOutcome>;
}

export function useFilesController({
  token,
  sessionReady,
  api = httpFilesApi,
  onUnauthorized,
}: FilesControllerOptions): FilesController {
  const [state, setState] = useState<FilesState>({
    files: [],
    selectedIds: new Set(),
    batchDeleting: false,
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const aliveRef = useRef(true);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<FilesRefreshResult> => {
    if (!token || !sessionReady) return { kind: 'skipped' };
    const result = await refreshFiles(token, api);
    if (!aliveRef.current) return result;
    if (result.kind === 'unauthorized') onUnauthorizedRef.current?.();
    setState((prev) => filesAfterRefresh(prev, result));
    return result;
  }, [api, sessionReady, token]);

  const probeWithToken = useCallback(async (nextToken: string): Promise<FilesRefreshResult> => {
    const result = await refreshFiles(nextToken, api);
    if (!aliveRef.current) return result;
    if (result.kind === 'ok') setState((prev) => filesAfterRefresh(prev, result));
    return result;
  }, [api]);

  const toggleSelected = useCallback((id: string) => {
    setState((prev) => toggleSelectionState(prev, id));
  }, []);

  const selectAll = useCallback(() => {
    setState((prev) => selectAllFiles(prev));
  }, []);

  const toggleAll = useCallback(() => {
    setState((prev) => toggleAllFiles(prev));
  }, []);

  const clearSelection = useCallback(() => {
    setState((prev) => clearSelectionState(prev));
  }, []);

  const reset = useCallback(() => {
    setState({ files: [], selectedIds: new Set(), batchDeleting: false });
  }, []);

  const deleteOne = useCallback(async (id: string): Promise<DeleteOneResult> => {
    if (!token) return { kind: 'unauthorized' };
    const result = await deleteFileById(token, id, api);
    if (!aliveRef.current) return result;
    if (result.kind === 'ok') setState((prev) => filesAfterDeleteOne(prev, id));
    return result;
  }, [api, token]);

  const deleteSelected = useCallback(async (): Promise<DeleteManyOutcome> => {
    const current = stateRef.current;
    if (!token || current.batchDeleting) return { kind: 'skipped' };
    const targets = selectedFiles(current.files, current.selectedIds);
    if (targets.length === 0) return { kind: 'skipped' };

    setState((prev) => ({ ...prev, batchDeleting: true }));
    try {
      const result = await deleteFiles(token, targets, api);
      if (!aliveRef.current) return result;
      if (result.kind === 'ok') setState((prev) => filesAfterDeleteMissing(prev));
      return result;
    } finally {
      if (aliveRef.current) setState((prev) => ({ ...prev, batchDeleting: false }));
    }
  }, [api, token]);

  return {
    files: state.files,
    selectedIds: state.selectedIds,
    batchDeleting: state.batchDeleting,
    allSelected: computeAllSelected(state.files, state.selectedIds),
    refresh,
    probeWithToken,
    toggleSelected,
    selectAll,
    toggleAll,
    clearSelection,
    reset,
    deleteOne,
    deleteSelected,
  };
}
