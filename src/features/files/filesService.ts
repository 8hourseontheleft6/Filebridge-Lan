/**
 * File list application service.
 *
 * Owns list refresh, selection pruning and delete semantics, including the
 * 401 mapping. Transport stays in `src/api/filesApi.ts`; no React here.
 */
import { ApiError } from '../../api/errors';
import { deleteFile as apiDeleteFile, listFiles as apiListFiles } from '../../api/filesApi';
import type {
  DeleteManyResult,
  DeleteOneResult,
  FilesApiPort,
  FilesRefreshResult,
  FilesState,
  HubFile,
} from './types';

export type { FilesApiPort };

export const httpFilesApi: FilesApiPort = {
  listFiles: (token) => apiListFiles(token),
  deleteFile: (token, id) => apiDeleteFile(token, id),
};

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function networkText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.kind === 'timeout') return '读取文件列表超时，请稍后重试';
    if (error.kind === 'network') return '无法连接 Hub，请确认服务在线';
    return error.message || fallback;
  }
  return errorText(error, fallback);
}

/** Load/refresh the list. Never throws: the caller decides what to show. */
export async function refreshFiles(
  token: string,
  api: FilesApiPort = httpFilesApi,
): Promise<FilesRefreshResult> {
  if (!token) return { kind: 'skipped' };
  try {
    const files = await api.listFiles(token);
    return { kind: 'ok', files: Array.isArray(files) ? files : [] };
  } catch (error) {
    if (isUnauthorized(error)) return { kind: 'unauthorized' };
    return { kind: 'error', message: networkText(error, '读取文件列表失败') };
  }
}

/** Delete one file; the caller shows the message and refreshes on success. */
export async function deleteFileById(
  token: string,
  id: string,
  api: FilesApiPort = httpFilesApi,
): Promise<DeleteOneResult> {
  try {
    await api.deleteFile(token, id);
    return { kind: 'ok' };
  } catch (error) {
    if (isUnauthorized(error)) return { kind: 'unauthorized' };
    return { kind: 'error', message: '删除失败，请稍后重试' };
  }
}

/**
 * Delete several files in order, stopping at the first failure. Keeps the
 * original per-file error copy (`删除 <name> 失败`).
 */
export async function deleteFiles(
  token: string,
  targets: HubFile[],
  api: FilesApiPort = httpFilesApi,
): Promise<DeleteManyResult> {
  const total = targets.length;
  let deleted = 0;
  for (const file of targets) {
    try {
      await api.deleteFile(token, file.id);
      deleted += 1;
    } catch (error) {
      if (isUnauthorized(error)) return { kind: 'unauthorized', deleted, total };
      return { kind: 'error', deleted, total, message: `删除 ${file.name} 失败` };
    }
  }
  return { kind: 'ok', deleted, total };
}

/** Drop selected ids that no longer exist in the refreshed list. */
export function pruneSelection(selectedIds: Set<string>, files: HubFile[]): Set<string> {
  const existing = new Set(files.map((file) => file.id));
  const next = new Set<string>();
  for (const id of selectedIds) {
    if (existing.has(id)) next.add(id);
  }
  return next;
}

export function allSelected(files: HubFile[], selectedIds: Set<string>): boolean {
  return files.length > 0 && files.every((file) => selectedIds.has(file.id));
}

/** Files that the current selection refers to, in list order. */
export function selectedFiles(files: HubFile[], selectedIds: Set<string>): HubFile[] {
  return files.filter((file) => selectedIds.has(file.id));
}

export function toggleSelection(state: FilesState, id: string): FilesState {
  const next = new Set(state.selectedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return { ...state, selectedIds: next };
}

export function selectAllFiles(state: FilesState): FilesState {
  return { ...state, selectedIds: new Set(state.files.map((file) => file.id)) };
}

export function toggleAllFiles(state: FilesState): FilesState {
  return allSelected(state.files, state.selectedIds)
    ? { ...state, selectedIds: new Set() }
    : selectAllFiles(state);
}

export function clearSelection(state: FilesState): FilesState {
  return { ...state, selectedIds: new Set() };
}

/** Apply a refresh result; failures keep the previous list untouched. */
export function filesAfterRefresh(state: FilesState, result: FilesRefreshResult): FilesState {
  if (result.kind !== 'ok') return state;
  return {
    ...state,
    files: result.files,
    selectedIds: pruneSelection(state.selectedIds, result.files),
  };
}

/** After a successful single delete the id leaves the selection immediately. */
export function filesAfterDeleteOne(state: FilesState, id: string): FilesState {
  const next = new Set(state.selectedIds);
  next.delete(id);
  return { ...state, selectedIds: next };
}

export function filesAfterDeleteMissing(state: FilesState): FilesState {
  return { ...state, selectedIds: new Set() };
}
