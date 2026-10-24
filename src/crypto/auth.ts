/**
 * Filebridge-Lan - 安全与认证模块
 * 
 * 安全模型（仅局域网，无公网）：
 * 1. 基于PIN的配对（6位数字码）
 * 2. ECDH密钥交换生成会话密钥
 * 3. AES-256-GCM负载加密（可选）
 * 4. 设备信任存储（记住已配对设备）
 * 
 * 流程：
 *   A生成PIN -> B输入PIN -> ECDH握手 -> 安全通道
 */

// ---- 类型定义 ----

export interface PairedDevice {
  deviceId: string;
  name: string;
  publicKey: string;       // base64编码的ECDH公钥
  pairedAt: number;
  lastUsed: number;
  trustLevel: 'temporary' | 'trusted';
}

export interface AuthChallenge {
  type: 'auth_challenge';
  deviceId: string;
  nonce: string;           // 随机挑战码
  publicKey: string;       // ECDH公钥
}

export interface AuthResponse {
  type: 'auth_response';
  deviceId: string;
  nonce: string;           // 已签名的nonce
  signature: string;       // nonce的HMAC签名
  publicKey: string;       // ECDH公钥
}

export interface PairingSession {
  pin: string;
  deviceId: string;
  createdAt: number;
  expiresAt: number;
  state: 'waiting_pin' | 'pin_verified' | 'key_exchanging' | 'paired';
}

// ---- PIN生成 ----

const PIN_LENGTH = 6;
const PIN_EXPIRY_MS = 120000; // 2分钟
const SESSION_EXPIRY_MS = 300000; // 5分钟

/**
 * 生成密码学安全的6位PIN码。
 * 使用Web Crypto API获取随机数。
 */
export function generatePIN(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  const pin = (array[0] % 900000 + 100000).toString();
  return pin;
}

/**
 * 验证PIN码格式（6位数字）。
 */
export function isValidPIN(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

// ---- ECDH密钥交换 ----

/**
 * 使用P-256曲线生成ECDH密钥对。
 * 使用Web Crypto API（SubtleCrypto）。
 */
export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true, // 可导出
    ['deriveKey', 'deriveBits']
  );
}

/**
 * 将公钥导出为base64字符串用于传输。
 */
export async function exportPublicKey(publicKey: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', publicKey);
  return arrayBufferToBase64(raw);
}

/**
 * 从base64字符串导入公钥。
 */
export async function importPublicKey(base64Key: string): Promise<CryptoKey> {
  const raw = base64ToArrayBuffer(base64Key);
  return crypto.subtle.importKey(
    'raw',
    raw,
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    []
  );
}

/**
 * 使用ECDH派生共享密钥。
 * 双方使用各自的私钥+对方的公钥计算出相同的密钥。
 */
export async function deriveSharedSecret(
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey
): Promise<ArrayBuffer> {
  return crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: peerPublicKey,
    },
    privateKey,
    256 // 256位
  );
}

/**
 * 从共享密钥派生AES-GCM密钥。
 */
export async function deriveAESKey(sharedSecret: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new ArrayBuffer(0), // 局域网简化，不使用盐值
      info: new TextEncoder().encode('FileBridge-AES-256-GCM'),
    },
    await crypto.subtle.importKey(
      'raw',
      sharedSecret,
      'HKDF',
      false,
      ['deriveKey']
    ),
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt']
  );
}

// ---- 加密/解密 ----

/**
 * 使用AES-256-GCM加密数据。
 * 返回base64编码的密文，IV前置。
 */
export async function encrypt(
  data: ArrayBuffer,
  key: CryptoKey
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96位IV
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    data
  );

  // 将IV前置到密文
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  return arrayBufferToBase64(combined.buffer);
}

/**
 * 使用AES-256-GCM解密数据。
 * 期望base64编码的密文，IV前置。
 */
export async function decrypt(
  ciphertext: string,
  key: CryptoKey
): Promise<ArrayBuffer> {
  const combined = base64ToArrayBuffer(ciphertext);
  const iv = new Uint8Array(combined.slice(0, 12));
  const data = combined.slice(12);

  return crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    data
  );
}

// ---- HMAC认证 ----

/**
 * 为挑战响应创建HMAC-SHA256签名。
 */
export async function createSignature(
  data: string,
  key: CryptoKey
): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(data)
  );
  return arrayBufferToBase64(signature);
}

/**
 * 验证HMAC-SHA256签名。
 */
export async function verifySignature(
  data: string,
  signature: string,
  key: CryptoKey
): Promise<boolean> {
  return crypto.subtle.verify(
    'HMAC',
    key,
    base64ToArrayBuffer(signature),
    new TextEncoder().encode(data)
  );
}

// ---- 配对管理器 ----

export class PairingManager {
  private pairedDevices: Map<string, PairedDevice> = new Map();
  private currentSession: PairingSession | null = null;
  private keyPair: CryptoKeyPair | null = null;
  private onDevicePaired: ((device: PairedDevice) => void) | null = null;
  private onDeviceRemoved: ((deviceId: string) => void) | null = null;

  constructor() {
    this.loadTrustStore();
  }

  onPaired(cb: (device: PairedDevice) => void) {
    this.onDevicePaired = cb;
  }

  onRemoved(cb: (deviceId: string) => void) {
    this.onDeviceRemoved = cb;
  }

  getPairedDevices(): PairedDevice[] {
    return Array.from(this.pairedDevices.values());
  }

  isPaired(deviceId: string): boolean {
    return this.pairedDevices.has(deviceId);
  }

  // ---- 发起方（桌面端）----

  /**
   * 作为发起方开始配对会话。
   * 生成PIN和ECDH密钥对。
   */
  async startPairing(): Promise<{ pin: string; session: PairingSession }> {
    const pin = generatePIN();
    this.keyPair = await generateKeyPair();

    this.currentSession = {
      pin,
      deviceId: '', // 对等设备连接时填充
      createdAt: Date.now(),
      expiresAt: Date.now() + PIN_EXPIRY_MS,
      state: 'waiting_pin',
    };

    return { pin, session: this.currentSession };
  }

  /**
   * 验证对等设备输入的PIN码。
   */
  verifyPIN(enteredPin: string): boolean {
    if (!this.currentSession) return false;
    if (Date.now() > this.currentSession.expiresAt) return false;
    
    const valid = this.currentSession.pin === enteredPin;
    if (valid) {
      this.currentSession.state = 'pin_verified';
    }
    return valid;
  }

  // ---- 响应方（移动端）----

  /**
   * 创建包含ECDH公钥的认证挑战。
   */
  async createChallenge(): Promise<AuthChallenge> {
    this.keyPair = await generateKeyPair();
    const publicKey = await exportPublicKey(this.keyPair.publicKey);
    const nonce = generateNonce();

    return {
      type: 'auth_challenge',
      deviceId: '', // 由调用方填充
      nonce,
      publicKey,
    };
  }

  /**
   * 响应认证挑战。
   */
  async respondToChallenge(
    challenge: AuthChallenge,
    pin: string
  ): Promise<AuthResponse> {
    if (!this.keyPair) throw new Error('没有密钥对');

    // 从PIN创建HMAC密钥
    const hmacKey = await derivePINKey(pin);
    
    // 签名nonce
    const signature = await createSignature(challenge.nonce, hmacKey);

    const publicKey = await exportPublicKey(this.keyPair.publicKey);

    return {
      type: 'auth_response',
      deviceId: '', // 由调用方填充
      nonce: challenge.nonce,
      signature,
      publicKey,
    };
  }

  /**
   * 验证认证响应并完成配对。
   */
  async verifyResponse(
    response: AuthResponse,
    pin: string,
    deviceId: string,
    deviceName: string
  ): Promise<boolean> {
    const hmacKey = await derivePINKey(pin);
    const valid = await verifySignature(response.nonce, response.signature, hmacKey);

    if (valid) {
      // 存储已配对设备
      const paired: PairedDevice = {
        deviceId,
        name: deviceName,
        publicKey: response.publicKey,
        pairedAt: Date.now(),
        lastUsed: Date.now(),
        trustLevel: 'trusted',
      };
      this.pairedDevices.set(deviceId, paired);
      this.saveTrustStore();

      if (this.onDevicePaired) {
        this.onDevicePaired(paired);
      }
    }

    return valid;
  }

  /**
   * 移除已配对设备。
   */
  removeDevice(deviceId: string) {
    this.pairedDevices.delete(deviceId);
    this.saveTrustStore();
    if (this.onDeviceRemoved) {
      this.onDeviceRemoved(deviceId);
    }
  }

  // ---- 会话管理 ----

  getSession(): PairingSession | null {
    return this.currentSession;
  }

  getKeyPair(): CryptoKeyPair | null {
    return this.keyPair;
  }

  clearSession() {
    this.currentSession = null;
    this.keyPair = null;
  }

  // ---- 信任存储（localStorage）----

  private async loadTrustStore() {
    try {
      const stored = localStorage.getItem('filebridge_paired_devices');
      if (stored) {
        const devices: PairedDevice[] = JSON.parse(stored);
        devices.forEach(d => this.pairedDevices.set(d.deviceId, d));
      }
    } catch {
      // 忽略损坏的数据
    }
  }

  private saveTrustStore() {
    try {
      const devices = Array.from(this.pairedDevices.values());
      localStorage.setItem('filebridge_paired_devices', JSON.stringify(devices));
    } catch {
      // 存储空间满或不可用
    }
  }
}

// ---- 辅助函数 ----

function generateNonce(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return arrayBufferToBase64(array.buffer);
}

async function derivePINKey(pin: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    'HKDF',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('FileBridge-PIN-v1'),
      info: encoder.encode('pairing-key'),
    },
    keyMaterial,
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign', 'verify']
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ---- 安全协议总结 ----
//
// 配对流程：
//   1. 桌面端生成6位PIN + ECDH密钥对
//   2. 移动端输入PIN
//   3. 桌面端验证PIN
//   4. ECDH密钥交换（P-256曲线）
//   5. 派生共享密钥
//   6. 派生AES-256-GCM会话密钥
//   7. 设备加入信任存储
//
// 重连：
//   - 已信任设备跳过PIN，使用存储的ECDH密钥
//   - 每次会话新ECDH密钥交换（前向保密）
//
// 威胁模型（仅局域网）：
//   - 同网络攻击者：PIN暴力破解防护（2分钟过期）
//   - 持有PIN的攻击者：ECDH防止无私钥的中间人攻击
//   - 无需PKI：首次信任（TOFU）模型
