const ADDITIONAL_PREFIX = 'filebridge-relay-v1:';

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function randomTransferKey(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function importTransferKey(keyB64: string): Promise<CryptoKey> {
  const raw = base64UrlToBytes(keyB64);
  if (raw.byteLength !== 32) throw new Error('传输密钥长度不正确');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function additionalData(index: number): ArrayBuffer {
  return new TextEncoder().encode(`${ADDITIONAL_PREFIX}${index}`).buffer as ArrayBuffer;
}

/** AES-GCM 分片加密；返回 12 字节 IV + 密文 + tag。 */
export async function encryptChunk(
  key: CryptoKey,
  index: number,
  plain: ArrayBuffer,
): Promise<ArrayBuffer> {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: additionalData(index) },
    key,
    plain,
  );
  const output = new Uint8Array(new ArrayBuffer(iv.byteLength + cipher.byteLength));
  output.set(iv, 0);
  output.set(new Uint8Array(cipher), iv.byteLength);
  return output.buffer;
}

/** 解密服务端分片；分片被调换/篡改会因 additionalData 或 tag 校验失败。 */
export async function decryptChunk(
  key: CryptoKey,
  index: number,
  encrypted: ArrayBuffer,
): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(encrypted);
  if (bytes.byteLength < 28) throw new Error('分片数据不完整');
  const iv = bytes.slice(0, 12);
  const cipher = bytes.slice(12);
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: additionalData(index) },
    key,
    cipher,
  );
}
