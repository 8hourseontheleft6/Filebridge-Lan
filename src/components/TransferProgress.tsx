import type { LiveUpload } from '../features/connection/types';
import type { ActiveDownload } from '../features/downloads/types';
import type { UploadState } from '../features/uploads/types';
import { formatBytes, formatDuration } from '../lib/format';
import { Icon } from './Icon';
import { RateCard } from './RateCard';

export interface ProgressBlock {
  key: string;
  leaving: boolean;
}

interface TransferProgressProps {
  upload: UploadState | null;
  uploadBlocks: ProgressBlock[];
  uploadIsBatch: boolean;
  uploadPercent: number;
  uploadLoadedBytes: number;
  uploadTotalBytes: number;
  uploadEta: number;
  uploadHistory: number[];
  shownUploadSpeed: number;
  uploadPeak: number;
  uploadTotal: number;
  downloadBlocks: ProgressBlock[];
  activeDownload: ActiveDownload | null;
  visibleLiveUpload: LiveUpload | null;
  liveFallback: LiveUpload | null;
  saveFallback: ActiveDownload | null;
  livePercent: number;
  liveEta: number;
  downloadPercent: number;
  downloadEta: number;
  downloadHistory: number[];
  shownDownloadSpeed: number;
  downloadPeak: number;
  downloadTotal: number;
  hasActiveTransfer: boolean;
  onCancelUpload: () => void;
  onResumeUpload: () => void;
  onCancelDownload: () => void;
}

function percentOf(loaded: number, total: number): number {
  if (total > 0) return Math.min(100, Math.round((loaded / total) * 100));
  return loaded > 0 ? 100 : 0;
}

/** Upload / receive / save readouts. Rate numbers come from the page. */
export function TransferProgress({
  upload,
  uploadBlocks,
  uploadIsBatch,
  uploadPercent,
  uploadLoadedBytes,
  uploadTotalBytes,
  uploadEta,
  uploadHistory,
  shownUploadSpeed,
  uploadPeak,
  uploadTotal,
  downloadBlocks,
  activeDownload,
  visibleLiveUpload,
  liveFallback,
  saveFallback,
  livePercent,
  liveEta,
  downloadPercent,
  downloadEta,
  downloadHistory,
  shownDownloadSpeed,
  downloadPeak,
  downloadTotal,
  hasActiveTransfer,
  onCancelUpload,
  onResumeUpload,
  onCancelDownload,
}: TransferProgressProps) {
  return (
    <div className={`progress-column${hasActiveTransfer ? '' : ' is-idle'}`}>
      <RateCard
        label="上传"
        direction="upload"
        speed={shownUploadSpeed}
        peak={uploadPeak}
        total={uploadTotal}
        history={uploadHistory}
        tone="blue"
      >
        {upload && uploadBlocks.map(({ key, leaving }) => (
          <div className={`reveal${leaving ? ' is-leaving' : ''}`} key={key} aria-hidden={leaving || undefined}>
            <div className="progress-block">
              <div className="progress-row">
                <span className="progress-title">
                  {uploadIsBatch
                    ? `总进度 · 第 ${upload.batchIndex || 1}/${upload.batchCount} 个`
                    : upload.status === 'done'
                      ? '已上传'
                      : upload.status === 'cancelled'
                        ? '已取消'
                        : upload.status === 'error'
                          ? '上传失败'
                          : '上传中'}
                </span>
                <span className="progress-row-end">
                  {!uploadIsBatch && <strong>{uploadPercent}%</strong>}
                  {(upload.status === 'uploading' || upload.status === 'retrying') && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon-round"
                      onClick={onCancelUpload}
                      aria-label="取消上传"
                      title="取消上传"
                    >
                      <Icon name="close" size={14} />
                    </button>
                  )}
                  {upload.status === 'error' && upload.file && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon-round"
                      onClick={onResumeUpload}
                      aria-label="继续上传"
                      title="继续上传"
                    >
                      <Icon name="refresh" size={14} />
                    </button>
                  )}
                  {upload.status === 'cancelled' && upload.file && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon-round"
                      onClick={onResumeUpload}
                      aria-label="重新上传"
                      title="重新上传"
                    >
                      <Icon name="refresh" size={14} />
                    </button>
                  )}
                </span>
              </div>
              <div className="progress-meta">
                <span>{formatBytes(uploadLoadedBytes)} / {formatBytes(uploadTotalBytes)}</span>
                {(upload.status === 'uploading' || upload.status === 'retrying') && <span>剩余 {formatDuration(uploadEta)}</span>}
                {upload.status === 'done' && (
                  <span className="upload-done">
                    <Icon name="check" size={13} /> {uploadPercent >= 100 ? '已上传' : '当前文件已上传'}
                  </span>
                )}
                {upload.status === 'retrying' && !upload.checking && <span>连接中断，正在重试…</span>}
                {upload.checking && <span>正在核对服务器已保存进度…</span>}
                {upload.status === 'error' && <span className="text-error" role="alert">{upload.error || '上传失败'}</span>}
              </div>
            </div>
          </div>
        ))}
      </RateCard>

      <RateCard
        label="下载"
        direction="download"
        speed={shownDownloadSpeed}
        peak={downloadPeak}
        total={downloadTotal}
        history={downloadHistory}
        tone="green"
      >
        {downloadBlocks.map(({ key, leaving }) => {
          const live = visibleLiveUpload ?? liveFallback;
          const save = activeDownload ?? saveFallback;
          const livePct = visibleLiveUpload ? livePercent : live ? percentOf(live.loaded, live.total) : 0;
          const savePct = activeDownload ? downloadPercent : save ? percentOf(save.loaded, save.total) : 0;
          return (
            <div className={`reveal${leaving ? ' is-leaving' : ''}`} key={key} aria-hidden={leaving || undefined}>
              {key === 'receive' && live && (
                <div className="progress-block">
                  <div className="progress-row">
                    <span className="progress-title">接收中</span>
                    <strong>{livePct}%</strong>
                  </div>
                  <div className="progress-meta">
                    <span>{formatBytes(live.loaded)} / {formatBytes(live.total)}</span>
                    {liveEta > 0 && <span>剩余 {formatDuration(liveEta)}</span>}
                  </div>
                </div>
              )}
              {key === 'save' && save && (
                <div className="progress-block">
                  <div className="progress-row">
                    <span className="progress-title">保存中</span>
                    <span className="progress-row-end">
                      <strong>{savePct}%</strong>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon-round"
                        onClick={onCancelDownload}
                        disabled={save.status === 'cancelling'}
                        aria-label="取消保存"
                        title="取消保存"
                      >
                        <Icon name={save.status === 'cancelling' ? 'refresh' : 'close'} size={14} className={save.status === 'cancelling' ? 'is-spinning' : undefined} />
                      </button>
                    </span>
                  </div>
                  <div className="progress-meta">
                    <span>{formatBytes(save.loaded)} / {formatBytes(save.total)}</span>
                    {downloadEta > 0 && <span>剩余 {formatDuration(downloadEta)}</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </RateCard>
    </div>
  );
}
