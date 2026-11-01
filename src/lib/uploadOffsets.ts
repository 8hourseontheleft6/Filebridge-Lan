export interface ServerUploadStatus {
  offset: number;
  complete: boolean;
  file?: unknown;
}

export interface UploadOffsetSnapshot {
  confirmedOffset: number;
  inFlightLoaded: number;
}

/**
 * The server is authoritative. A missing/failed status query must leave the
 * last confirmed offset untouched; it must never promote in-flight bytes.
 */
export function resolveServerOffset(
  current: UploadOffsetSnapshot,
  status: ServerUploadStatus | null | undefined,
): UploadOffsetSnapshot {
  if (!status) return current;
  return {
    confirmedOffset: status.offset,
    inFlightLoaded: status.offset,
  };
}

export function hasServerFile(status: ServerUploadStatus | null | undefined): boolean {
  return Boolean(status?.complete && status.file);
}

export function shouldShowLiveUpload(
  localUploadId: string | undefined,
  liveUploadId: string | undefined,
): boolean {
  return Boolean(liveUploadId && liveUploadId !== localUploadId);
}

export function confirmedPercent(confirmed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((confirmed / total) * 100)));
}
