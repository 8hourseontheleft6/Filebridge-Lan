export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0B';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--';
  if (seconds < 1) return '<1s';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  if (minutes < 60) return `${minutes}m ${secs}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
