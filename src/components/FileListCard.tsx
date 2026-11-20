import { useRef } from 'react';

import type { HubFile } from '../features/files/types';
import { formatBytes } from '../lib/format';
import { Icon } from './Icon';

export interface FileListRow {
  key: string;
  item: HubFile;
  leaving: boolean;
}

interface FileListCardProps {
  files: HubFile[];
  fileRows: FileListRow[];
  selectedIds: Set<string>;
  allSelected: boolean;
  online: boolean | null;
  desktop: boolean;
  needsPicker: boolean;
  pendingFiles: File[];
  refreshSpinning: boolean;
  error: string;
  savingId: string | null;
  batchSaving: boolean;
  batchDeleting: boolean;
  savedPaths: Record<string, string>;
  onSelectFiles: (files: FileList | File[]) => void;
  onUploadPending: () => void;
  onClearPending: () => void;
  onSaveSelected: () => void;
  onDeleteSelected: () => void;
  onToggleAll: () => void;
  onRefresh: () => void;
  onOpenDownloadDir: () => void;
  onToggleSelected: (id: string) => void;
  onSaveFile: (file: HubFile) => void;
  onOpenPath: (path: string) => void;
  onDeleteFile: (id: string) => void;
  downloadUrl: (file: HubFile) => string;
  onBrowserDownload: (file: HubFile) => void;
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  return ext ? ext.slice(0, 4).toUpperCase() : 'FILE';
}

/** File list card: presentation and page-level button wiring only. */
export function FileListCard({
  files,
  fileRows,
  selectedIds,
  allSelected,
  online,
  desktop,
  needsPicker,
  pendingFiles,
  refreshSpinning,
  error,
  savingId,
  batchSaving,
  batchDeleting,
  savedPaths,
  onSelectFiles,
  onUploadPending,
  onClearPending,
  onSaveSelected,
  onDeleteSelected,
  onToggleAll,
  onRefresh,
  onOpenDownloadDir,
  onToggleSelected,
  onSaveFile,
  onOpenPath,
  onDeleteFile,
  downloadUrl,
  onBrowserDownload,
}: FileListCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);

  return (
    <article className="card files-card">
      <div className="card-head">
        <div>
          <h2>文件列表</h2>
        </div>
        <div className="card-actions">
          <span className="count-badge">{files.length}</span>
          {selectedIds.size > 0 && (
            <button
              type="button"
              className="btn btn-primary btn-small"
              onClick={onSaveSelected}
              disabled={online === false || batchSaving || batchDeleting || savingId !== null}
            >
              {desktop ? '保存所选' : '下载所选'} ({selectedIds.size})
            </button>
          )}
          {selectedIds.size > 0 && (
            <button
              type="button"
              className="btn btn-danger btn-small"
              onClick={onDeleteSelected}
              disabled={online === false || batchDeleting || batchSaving || savingId !== null}
            >
              {batchDeleting ? '删除中…' : `删除所选 (${selectedIds.size})`}
            </button>
          )}
          {files.length > 0 && (
            <button
              type="button"
              className={`btn btn-ghost btn-icon-round${allSelected ? ' is-active' : ''}`}
              onClick={onToggleAll}
              disabled={online === false}
              aria-pressed={allSelected}
              aria-label={allSelected ? '取消全选' : '全选'}
              title={allSelected ? '取消全选' : '全选'}
            >
              <Icon name="check" size={15} />
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-icon-round"
            onClick={() => {
              if (online === false) return;
              inputRef.current?.click();
            }}
            disabled={online === false}
            aria-label="选择文件上传"
            title="选择文件上传"
          >
            <Icon name="plus" size={15} />
          </button>
          {desktop && (
            <button type="button" className="btn btn-ghost btn-icon-round" onClick={onOpenDownloadDir} title="打开下载文件夹" aria-label="打开下载文件夹">
              <Icon name="folder" size={14} />
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-icon-round"
            aria-label="刷新文件列表"
            title="刷新"
            onClick={onRefresh}
          >
            <Icon name="refresh" size={14} className={refreshSpinning ? 'is-spinning' : undefined} />
          </button>
        </div>
      </div>

      {online === false && (
        <p className="offline-cache-note" role="status">
          <Icon name="alert" size={14} /> 离线缓存，可能已过期
        </p>
      )}

      {needsPicker && (
        <div className="ios-media-picker">
          <button type="button" className="btn btn-small btn-ghost" onClick={() => mediaInputRef.current?.click()} disabled={online === false}>
            选择照片 / 视频
          </button>
          <span>Safari 可连续选择多张；iCloud 照片请先下载原片</span>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        disabled={online === false}
        aria-label="选择要上传的文件"
        style={{ display: 'none' }}
        onChange={(event) => {
          if (event.target.files && event.target.files.length > 0) {
            onSelectFiles(event.target.files);
          }
          event.target.value = '';
        }}
      />

      <input
        ref={mediaInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        disabled={online === false}
        aria-label="选择照片或视频"
        style={{ display: 'none' }}
        onChange={(event) => {
          if (event.target.files && event.target.files.length > 0) {
            onSelectFiles(event.target.files);
          }
          event.target.value = '';
        }}
      />

      {pendingFiles.length > 0 && (
        <div className="pending-files" role="status">
          <p>已选择 {pendingFiles.length} 个文件，可继续添加后统一上传。</p>
          <div className="pending-actions">
            <button type="button" className="btn btn-small btn-ghost" onClick={() => mediaInputRef.current?.click()} disabled={online === false}>
              继续选择
            </button>
            <button type="button" className="btn btn-small btn-primary" onClick={onUploadPending} disabled={online === false}>
              开始上传
            </button>
            <button type="button" className="btn btn-small btn-ghost" onClick={onClearPending}>
              清空
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-error form-error">{error}</p>}

      <div className={`file-list-wrap${files.length > 0 ? ' has-files' : ''}`}>
        <div className="file-list">
          {fileRows.length === 0 && (
            <p className="file-list-empty">
              把文件拖到窗口任意位置，或点右上角 <Icon name="plus" size={13} /> 上传
            </p>
          )}
          {fileRows.map(({ key, item: file, leaving }) => (
            <div className={`reveal${leaving ? ' is-leaving' : ''}`} key={key} aria-hidden={leaving || undefined}>
              <div className={`file-item file-row${selectedIds.has(file.id) ? ' selected' : ''}`}>
                <label className="file-select-hit">
                  <input
                    type="checkbox"
                    className="file-select"
                    checked={selectedIds.has(file.id)}
                    onChange={() => onToggleSelected(file.id)}
                    disabled={online === false}
                    aria-label={`选择 ${file.name}`}
                  />
                </label>
                <span className="file-icon file-ext" aria-hidden>{fileExtension(file.name)}</span>
                <div className="file-main" title={file.name}>
                  <div className="file-name">{file.name}</div>
                  <div className="file-status">
                    {formatBytes(file.size)} · SHA-256 {file.sha256.slice(0, 10)}…
                  </div>
                </div>
                <div className="file-actions">
                  {desktop ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-small btn-ghost"
                        onClick={() => onSaveFile(file)}
                        disabled={online === false || savingId !== null || batchSaving || batchDeleting}
                        title={`保存 ${file.name}`}
                      >
                        {savingId === file.id ? '保存中…' : savedPaths[file.id] ? '重新保存' : (<><Icon name="download" size={14} /> 保存</>)}
                      </button>
                      {savedPaths[file.id] && (
                        <button
                          type="button"
                          className="btn btn-icon"
                          onClick={() => onOpenPath(savedPaths[file.id])}
                          title="打开所在文件夹"
                          aria-label="打开所在文件夹"
                        >
                          <Icon name="folder" size={14} />
                        </button>
                      )}
                    </>
                  ) : (
                    <a
                      className={`btn btn-small btn-ghost${online === false ? ' is-disabled' : ''}`}
                      href={downloadUrl(file)}
                      download={file.name}
                      aria-disabled={online === false}
                      onClick={(event) => {
                        if (online === false) {
                          event.preventDefault();
                          return;
                        }
                        onBrowserDownload(file);
                      }}
                      title={`下载 ${file.name}`}
                      aria-label={`下载 ${file.name}`}
                    >
                      <Icon name="download" size={14} />
                    </a>
                  )}
                  <button
                    type="button"
                    className="btn btn-icon"
                    onClick={() => onDeleteFile(file.id)}
                    disabled={online === false}
                    title={`删除 ${file.name}`}
                    aria-label={`删除 ${file.name}`}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}
