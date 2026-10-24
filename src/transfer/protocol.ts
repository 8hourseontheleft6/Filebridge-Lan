/**
 * Filebridge-Lan - 文件传输协议
 * 
 * 传输模式：
 * 1. 小文件（<16MB）：单次WebSocket消息
 * 2. 大文件（>=16MB）：通过WebRTC DataChannel分块传输
 * 3. 元数据：文件名、大小、哈希、MIME类型
 * 4. 完整性：SHA-256哈希校验
 * 
 * API：基于WebSocket + WebRTC DataChannel的类REST命令
 */

// ---- 类型定义 ----

export enum TransferMode {
  DIRECT = 'direct',       // 单次消息（小文件）
  CHUNKED = 'chunked',     // 分块传输（大文件）
  STREAM = 'stream',       // 流式传输（实时数据）
}

export enum TransferStatus {
  PENDING = 'pending',
  TRANSFERRING = 'transferring',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface FileMeta {
  id: string;              // 唯一传输ID
  name: string;            // 原始文件名
  size: number;            // 文件大小（字节）
  mimeType: string;        // MIME类型
  hash: string;            // 整个文件的SHA-256哈希
  hashAlgorithm: 'sha256';
  lastModified: number;    // 文件最后修改时间戳
}

export interface TransferRequest {
  type: 'transfer_request';
  file: FileMeta;
  mode: TransferMode;
  destinationId: string;
}

export interface TransferResponse {
  type: 'transfer_response';
  requestId: string;
  accepted: boolean;
  reason?: string;
  chunkSize?: number;      // 协商后的分块大小
}

export interface ChunkMessage {
  type: 'chunk';
  transferId: string;
  index: number;           // 分块索引（从0开始）
  totalChunks: number;
  data: ArrayBuffer;       // 分块二进制数据
  hash: string;            // 此分块的SHA-256哈希
  size: number;            // 实际分块大小（最后一块可能较小）
}

export interface ChunkAck {
  type: 'chunk_ack';
  transferId: string;
  index: number;
  received: boolean;
}

export interface TransferProgress {
  transferId: string;
  bytesTransferred: number;
  totalBytes: number;
  speed: number;           // 每秒字节数
  eta: number;             // 预计剩余秒数
  status: TransferStatus;
}

export interface TransferComplete {
  type: 'transfer_complete';
  transferId: string;
  hash: string;            // 重组后文件的SHA-256哈希
  verified: boolean;
}

// ---- 常量 ----

const SMALL_FILE_THRESHOLD = 16 * 1024 * 1024; // 16MB
const DEFAULT_CHUNK_SIZE = 256 * 1024;          // 256KB
const MAX_CHUNK_SIZE = 1024 * 1024;             // 1MB（WebRTC限制）
const MIN_CHUNK_SIZE = 16 * 1024;               // 16KB
const TRANSFER_TIMEOUT_MS = 30000;              // 每块30秒超时
const MAX_RETRIES = 3;

// ---- 分块大小算法 ----

/**
 * 基于文件大小和网络状况的动态分块大小计算。
 * 
 * 策略：
 * - 小文件（<16MB）：单块（直接传输）
 * - 中等文件（16MB-1GB）：固定256KB分块
 * - 大文件（>1GB）：基于RTT的自适应分块
 * 
 * 自适应公式：
 *   chunkSize = min(max(MIN_CHUNK_SIZE, RTT * BANDWIDTH_TARGET), MAX_CHUNK_SIZE)
 * 
 * 其中：
 *   RTT = 往返时间（秒）
 *   BANDWIDTH_TARGET = 目标吞吐量（默认：10MB/s）
 */
export function calculateChunkSize(fileSize: number, rtt?: number): number {
  if (fileSize < SMALL_FILE_THRESHOLD) {
    return fileSize; // 单块
  }

  if (rtt && fileSize > 1024 * 1024 * 1024) {
    // 超大文件自适应
    const bandwidthTarget = 10 * 1024 * 1024; // 10MB/s
    const adaptiveSize = Math.round(rtt * bandwidthTarget);
    return Math.min(Math.max(adaptiveSize, MIN_CHUNK_SIZE), MAX_CHUNK_SIZE);
  }

  return DEFAULT_CHUNK_SIZE;
}

export function determineTransferMode(fileSize: number): TransferMode {
  if (fileSize < SMALL_FILE_THRESHOLD) return TransferMode.DIRECT;
  return TransferMode.CHUNKED;
}

// ---- 传输队列 ----

export interface QueueItem {
  id: string;
  fileMeta: FileMeta;
  mode: TransferMode;
  status: TransferStatus;
  priority: number;        // 0（最高）到10（最低）
  progress: TransferProgress;
  createdAt: number;
  chunks: ChunkInfo[];
}

interface ChunkInfo {
  index: number;
  offset: number;
  size: number;
  hash: string;
  status: 'pending' | 'sent' | 'acked' | 'failed';
  retries: number;
}

export class TransferQueue {
  private queue: QueueItem[] = [];
  private activeTransfers: Map<string, QueueItem> = new Map();
  private maxConcurrent = 3;
  private onProgress: ((progress: TransferProgress) => void) | null = null;
  private onComplete: ((transferId: string) => void) | null = null;
  private onError: ((transferId: string, error: string) => void) | null = null;

  setMaxConcurrent(n: number) {
    this.maxConcurrent = Math.max(1, Math.min(n, 10));
  }

  onTransferProgress(cb: (progress: TransferProgress) => void) {
    this.onProgress = cb;
  }

  onTransferComplete(cb: (transferId: string) => void) {
    this.onComplete = cb;
  }

  onTransferError(cb: (transferId: string, error: string) => void) {
    this.onError = cb;
  }

  enqueue(item: QueueItem): string {
    // 按优先级插入
    const insertIndex = this.queue.findIndex(q => q.priority > item.priority);
    if (insertIndex === -1) {
      this.queue.push(item);
    } else {
      this.queue.splice(insertIndex, 0, item);
    }
    this.processQueue();
    return item.id;
  }

  cancel(transferId: string) {
    // 从队列移除
    this.queue = this.queue.filter(q => q.id !== transferId);
    // 取消活跃传输
    const active = this.activeTransfers.get(transferId);
    if (active) {
      active.status = TransferStatus.CANCELLED;
      this.activeTransfers.delete(transferId);
    }
  }

  pause(transferId: string) {
    const item = this.findItem(transferId);
    if (item && item.status === TransferStatus.TRANSFERRING) {
      item.status = TransferStatus.PAUSED;
    }
  }

  resume(transferId: string) {
    const item = this.findItem(transferId);
    if (item && item.status === TransferStatus.PAUSED) {
      item.status = TransferStatus.PENDING;
      this.processQueue();
    }
  }

  getQueue(): QueueItem[] {
    return [...this.queue];
  }

  getActiveTransfers(): QueueItem[] {
    return Array.from(this.activeTransfers.values());
  }

  private findItem(transferId: string): QueueItem | undefined {
    return this.queue.find(q => q.id === transferId) ||
           this.activeTransfers.get(transferId);
  }

  private processQueue() {
    while (this.activeTransfers.size < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift()!;
      item.status = TransferStatus.TRANSFERRING;
      this.activeTransfers.set(item.id, item);
      this.startTransfer(item);
    }
  }

  private async startTransfer(item: QueueItem) {
    try {
      // 传输逻辑由FileTransfer类处理
      // 此队列仅管理排序和并发
      this.emitProgress(item);
    } catch (error) {
      item.status = TransferStatus.FAILED;
      this.activeTransfers.delete(item.id);
      if (this.onError) {
        this.onError(item.id, String(error));
      }
      this.processQueue();
    }
  }

  completeTransfer(transferId: string) {
    this.activeTransfers.delete(transferId);
    if (this.onComplete) {
      this.onComplete(transferId);
    }
    this.processQueue();
  }

  emitProgress(item: QueueItem) {
    if (this.onProgress) {
      this.onProgress(item.progress);
    }
  }
}

// ---- 分块算法 ----

/**
 * 将文件分割为传输用的分块。
 * 
 * 固定大小分块：
 * - 简单、可预测
 * - 每个分块可独立校验
 * - 支持以分块为粒度的暂停/恢复
 * 
 * @param file - 要分块的文件
 * @param chunkSize - 每个分块的大小
 * @returns 分块元数据数组
 */
export function createChunks(file: File, chunkSize: number): ChunkInfo[] {
  const chunks: ChunkInfo[] = [];
  const totalChunks = Math.ceil(file.size / chunkSize);

  for (let i = 0; i < totalChunks; i++) {
    const offset = i * chunkSize;
    const size = Math.min(chunkSize, file.size - offset);
    chunks.push({
      index: i,
      offset,
      size,
      hash: '', // 实际传输时计算
      status: 'pending',
      retries: 0,
    });
  }

  return chunks;
}

/**
 * 从文件中读取指定分块。
 * 使用File.slice()实现高效随机访问。
 */
export function readChunk(file: File, chunk: ChunkInfo): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const blob = file.slice(chunk.offset, chunk.offset + chunk.size);
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('读取分块失败'));
    reader.readAsArrayBuffer(blob);
  });
}

// ---- 完整性校验 ----

/**
 * 简单哈希函数（不依赖crypto.subtle）。
 * 手机浏览器通过HTTP访问时crypto.subtle不可用。
 * 使用FNV-1a算法，足够用于完整性校验。
 */
function fnv1a(data: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * 计算数据的哈希值。
 * 优先使用Web Crypto API（HTTPS环境），降级到FNV-1a。
 */
export async function computeHash(data: ArrayBuffer): Promise<string> {
  try {
    if (crypto.subtle?.digest) {
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // 降级到FNV-1a
  }
  return fnv1a(new Uint8Array(data));
}

/**
 * 计算文件的哈希值。
 */
export async function computeFileHash(file: File): Promise<string> {
  const chunkSize = 1024 * 1024;
  const totalChunks = Math.ceil(file.size / chunkSize);
  
  if (file.size < 100 * 1024 * 1024) {
    const buffer = await file.arrayBuffer();
    return computeHash(buffer);
  }

  const hashPromises: Promise<string>[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const offset = i * chunkSize;
    const size = Math.min(chunkSize, file.size - offset);
    const blob = file.slice(offset, offset + size);
    const buffer = await blob.arrayBuffer();
    hashPromises.push(computeHash(buffer));
  }

  const chunkHashes = await Promise.all(hashPromises);
  const combined = chunkHashes.join('');
  const encoder = new TextEncoder();
  return computeHash(encoder.encode(combined).buffer);
}

// ---- 传输API规范 ----
//
// 基于WebSocket的类REST命令：
//
// 1. 请求：发送方 -> 接收方
//    { type: "transfer_request", file: FileMeta, mode: "chunked", destinationId: "..." }
//
// 2. 响应：接收方 -> 发送方
//    { type: "transfer_response", requestId: "...", accepted: true, chunkSize: 262144 }
//
// 3. 分块：发送方 -> 接收方（通过WebRTC DataChannel）
//    { type: "chunk", transferId: "...", index: 0, totalChunks: 42, data: <binary>, hash: "..." }
//
// 4. 确认：接收方 -> 发送方
//    { type: "chunk_ack", transferId: "...", index: 0, received: true }
//
// 5. 完成：发送方 -> 接收方
//    { type: "transfer_complete", transferId: "...", hash: "...", verified: true }
//
// 错误处理：
// - 分块超时：最多重试3次
// - 哈希不匹配：重试该分块
// - 连接断开：暂停队列，重连后恢复
// - 磁盘满：取消传输，通知用户
