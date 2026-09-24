import mongoose, { Schema, Document, Types } from 'mongoose';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface IAIConfiguration {
  workspaceId: Types.ObjectId;
  provider: 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'mock';
  enabled: boolean;
  model: string;
  temperature: number;
  maxTokens: number;
  apiKeyEncrypted: string;
  features: {
    workflowGeneration: boolean;
    failureAnalysis: boolean;
    optimization: boolean;
  };
  createdBy: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAIConfigurationMethods {
  getDecryptedApiKey(): string;
}

export type AIConfigurationDocument = Document<Types.ObjectId> & IAIConfiguration & IAIConfigurationMethods;

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM

function getEncryptionKey(): Buffer {
  const secret = process.env.IDP_SECRET_KEY || process.env.WEBHOOK_SECRET_KEY || 'default-secret-key-32-chars-long!!';
  return createHash('sha256').update(secret).digest();
}

/**
 * Encrypt a plaintext secret using AES-256-GCM.
 */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${encrypted.toString('base64')}.${iv.toString('base64')}.${tag.toString('base64')}`;
}

/**
 * Decrypt an AES-256-GCM encrypted secret.
 */
export function decryptSecret(encryptedString: string): string {
  const [encryptedData, iv, tag] = encryptedString.split('.');
  if (!encryptedData || !iv || !tag) {
    throw new Error('API_KEY_CORRUPTED');
  }

  const key = getEncryptionKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(encryptedData, 'base64'),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

const AIConfigurationSchema = new Schema<IAIConfiguration, mongoose.Model<IAIConfiguration, {}, IAIConfigurationMethods>, IAIConfigurationMethods>({
  workspaceId: {
    type: Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    unique: true, // One config per workspace
  },
  provider: {
    type: String,
    enum: ['openai', 'anthropic', 'gemini', 'openrouter', 'mock'],
    required: true,
  },
  enabled: {
    type: Boolean,
    default: false,
  },
  model: {
    type: String,
    required: true,
  },
  temperature: {
    type: Number,
    min: 0,
    max: 2,
    default: 0.7,
  },
  maxTokens: {
    type: Number,
    min: 1,
    default: 1000,
  },
  apiKeyEncrypted: {
    type: String,
    required: function (this: any): boolean {
      return this.provider !== 'mock';
    },
  },
  features: {
    workflowGeneration: {
      type: Boolean,
      default: true,
    },
    failureAnalysis: {
      type: Boolean,
      default: true,
    },
    optimization: {
      type: Boolean,
      default: true,
    },
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
}, { timestamps: true });

// Index for faster lookups
AIConfigurationSchema.index({ provider: 1 });
AIConfigurationSchema.index({ enabled: 1 });

// Pre-save hook to encrypt API key if it's not already encrypted
AIConfigurationSchema.pre('save', async function (this: any) {
  if (this.isModified('apiKeyEncrypted') && this.apiKeyEncrypted && !this.apiKeyEncrypted.startsWith('enc:')) {
    const encrypted = encryptSecret(this.apiKeyEncrypted);
    this.apiKeyEncrypted = encrypted;
  }
});

// Method to safely get decrypted API key
AIConfigurationSchema.methods.getDecryptedApiKey = function (this: any): string {
  try {
    return decryptSecret(this.apiKeyEncrypted);
  } catch {
    throw new Error('Failed to decrypt API key');
  }
};

export const AIConfigurationModel = mongoose.model<IAIConfiguration, mongoose.Model<IAIConfiguration, {}, IAIConfigurationMethods>>('AIConfiguration', AIConfigurationSchema);
