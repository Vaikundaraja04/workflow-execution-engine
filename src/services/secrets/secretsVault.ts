import crypto from 'crypto';

export interface EncryptedPayload {
  encryptedValue: string; // hex
  iv: string; // hex
  tag: string; // hex
  kekVersion: string;
}

export interface ISecretsVault {
  encrypt(plaintext: string, kekVersion?: string): Promise<EncryptedPayload>;
  decrypt(payload: EncryptedPayload): Promise<string>;
}

/**
 * Local AES-256-GCM Envelope Encryption Vault
 */
export class LocalEncryptedVault implements ISecretsVault {
  private masterKeys: Map<string, Buffer>;
  private defaultKekVersion: string;

  constructor(masterKeyHex?: string, defaultVersion = 'v1') {
    this.defaultKekVersion = defaultVersion;
    this.masterKeys = new Map();

    const keyBuf = masterKeyHex
      ? Buffer.from(masterKeyHex, 'hex')
      : crypto.scryptSync(process.env.SECRETS_MASTER_KEY || 'default-workflow-enterprise-master-key-32', 'salt-kek-phase8', 32);

    this.masterKeys.set(defaultVersion, keyBuf);
  }

  /**
   * Register a new KEK version for rotation
   */
  public addKeyVersion(version: string, keyHex: string): void {
    this.masterKeys.set(version, Buffer.from(keyHex, 'hex'));
  }

  public async encrypt(plaintext: string, kekVersion = this.defaultKekVersion): Promise<EncryptedPayload> {
    const kek = this.masterKeys.get(kekVersion);
    if (!kek) {
      throw new Error(`Master KEK version '${kekVersion}' not found in vault`);
    }

    const iv = crypto.randomBytes(12); // 96-bit IV for AES-GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag().toString('hex');

    return {
      encryptedValue: encrypted,
      iv: iv.toString('hex'),
      tag,
      kekVersion,
    };
  }

  public async decrypt(payload: EncryptedPayload): Promise<string> {
    const kek = this.masterKeys.get(payload.kekVersion);
    if (!kek) {
      throw new Error(`Master KEK version '${payload.kekVersion}' not found in vault`);
    }

    const iv = Buffer.from(payload.iv, 'hex');
    const tag = Buffer.from(payload.tag, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', kek, iv);

    decipher.setAuthTag(tag);

    let decrypted = decipher.update(payload.encryptedValue, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}

export const defaultVault = new LocalEncryptedVault();
