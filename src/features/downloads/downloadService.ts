/**
 * Download application service.
 *
 * Pure mapping between Tauri save failures/results and the copy the page
 * shows. No React, no Tauri calls; the controller owns the side effects.
 */
import type { SavedFile } from '../../platform/tauri';
import type { DownloadToast } from './types';

/** `已取消` keeps the original cancellation copy; everything else is a save failure. */
export function mapSaveError(reason: unknown): {
  kind: 'cancelled' | 'error';
  message: string;
} {
  const message = String(reason);
  if (message.includes('已取消')) {
    return { kind: 'cancelled', message: '已取消保存' };
  }
  return { kind: 'error', message: `保存失败：${message}` };
}

export function savedToast(result: SavedFile): DownloadToast {
  return {
    text: result.existed
      ? `文件已存在，未重复保存：${result.path}`
      : `下载完成：${result.path}`,
    kind: 'success',
    path: result.path,
  };
}

export function batchSavedToast(completed: number, total: number): DownloadToast {
  return { text: `已保存 ${completed}/${total} 个文件`, kind: 'success' };
}

export function browserBatchToast(count: number): DownloadToast {
  return { text: `已开始下载 ${count} 个文件，请查看浏览器下载列表`, kind: 'info' };
}
