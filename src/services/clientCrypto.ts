/**
 * Client-Side Encryption Service (Architecture Document Section 10)
 * 
 * - The local DuckDB file is encrypted at rest using AES-GCM 256-bit.
 * - Encryption key is derived from user credentials using PBKDF2 (100,000 rounds).
 * - Key is held strictly in memory while the application is unlocked.
 * - On logout or device lock, the key is wiped; the database becomes inaccessible.
 */

const STORAGE_KEY = 'dual_duckdb_encrypted_store_v1';
const SALT_STORAGE_KEY = 'dual_duckdb_kdf_salt_v1';

export class ClientCryptoService {
  private memoryCryptoKey: CryptoKey | null = null;
  private isUnlocked: boolean = false;
  private currentSalt: Uint8Array | null = null;

  constructor() {
    this.initSalt();
  }

  private initSalt(): void {
    const existingSaltHex = localStorage.getItem(SALT_STORAGE_KEY);
    if (existingSaltHex) {
      this.currentSalt = this.hexToBuffer(existingSaltHex);
    } else {
      const newSalt = window.crypto.getRandomValues(new Uint8Array(16));
      this.currentSalt = newSalt;
      localStorage.setItem(SALT_STORAGE_KEY, this.bufferToHex(newSalt));
    }
  }

  /**
   * Derives a 256-bit AES-GCM key from user passphrase / SSO secret using PBKDF2
   */
  public async unlock(passphrase: string): Promise<boolean> {
    try {
      const enc = new TextEncoder();
      const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        enc.encode(passphrase),
        'PBKDF2',
        false,
        ['deriveKey']
      );

      this.memoryCryptoKey = await window.crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: this.currentSalt as unknown as BufferSource,
          iterations: 100000,
          hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );

      this.isUnlocked = true;
      return true;
    } catch (err) {
      console.error('[ClientCrypto] Failed to derive encryption key:', err);
      this.isUnlocked = false;
      this.memoryCryptoKey = null;
      return false;
    }
  }

  /**
   * Wipes the encryption key from memory; local database becomes inaccessible.
   */
  public lock(): void {
    this.memoryCryptoKey = null;
    this.isUnlocked = false;
    console.log('[ClientCrypto] Key wiped from memory. Database locked.');
  }

  public getUnlockedStatus(): boolean {
    return this.isUnlocked;
  }

  /**
   * Encrypts arbitrary serializable database state and stores at rest
   */
  public async encryptAndStore(data: any): Promise<void> {
    if (!this.isUnlocked || !this.memoryCryptoKey) {
      throw new Error('Database is locked. Cannot encrypt without memory key.');
    }

    const jsonString = JSON.stringify(data);
    const enc = new TextEncoder();
    const encoded = enc.encode(jsonString);

    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      this.memoryCryptoKey,
      encoded
    );

    const storagePayload = {
      iv: this.bufferToHex(iv),
      cipher: this.bufferToHex(new Uint8Array(ciphertext)),
      encrypted_at: new Date().toISOString(),
      size_bytes: ciphertext.byteLength,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(storagePayload));
  }

  /**
   * Retrieves and decrypts the encrypted database payload from storage
   */
  public async loadAndDecrypt(): Promise<any | null> {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    if (!this.isUnlocked || !this.memoryCryptoKey) {
      throw new Error('Database is locked. Provide passphrase to unlock.');
    }

    try {
      const parsed = JSON.parse(raw);
      const iv = this.hexToBuffer(parsed.iv);
      const cipher = this.hexToBuffer(parsed.cipher);

      const decryptedBuffer = await window.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv as unknown as BufferSource,
        },
        this.memoryCryptoKey,
        cipher as unknown as BufferSource
      );

      const dec = new TextDecoder();
      const jsonStr = dec.decode(decryptedBuffer);
      return JSON.parse(jsonStr);
    } catch (err: any) {
      console.error('[ClientCrypto] Decryption failed (invalid key or corrupted data):', err);
      throw new Error('Invalid passphrase or corrupted encrypted database.');
    }
  }

  public hasStoredData(): boolean {
    return localStorage.getItem(STORAGE_KEY) !== null;
  }

  public getEncryptedPayloadMetadata(): { sizeBytes: number; encryptedAt: string } | null {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return {
        sizeBytes: parsed.size_bytes || 0,
        encryptedAt: parsed.encrypted_at || 'unknown',
      };
    } catch {
      return null;
    }
  }

  private bufferToHex(buf: Uint8Array): string {
    return Array.from(buf)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private hexToBuffer(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }
}

export const clientCrypto = new ClientCryptoService();
