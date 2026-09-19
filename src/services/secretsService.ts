import { Types } from 'mongoose';
import { SecretModel, type ISecret } from '../models/SecretModel.js';
import { defaultVault, type ISecretsVault } from './secrets/secretsVault.js';
import { createAuditLog } from './auditService.js';

export interface CreateSecretInput {
  workspaceId?: string | Types.ObjectId;
  name: string;
  environment: 'development' | 'staging' | 'production';
  value: string;
  userId?: string | Types.ObjectId;
}

export class SecretsService {
  private vault: ISecretsVault;

  constructor(vault: ISecretsVault = defaultVault) {
    this.vault = vault;
  }

  /**
   * Create or update an encrypted environment secret
   */
  public async setSecret(input: CreateSecretInput): Promise<ISecret> {
    const wsId = input.workspaceId ? new Types.ObjectId(input.workspaceId.toString()) : undefined;
    const uId = input.userId ? new Types.ObjectId(input.userId.toString()) : undefined;

    const encrypted = await this.vault.encrypt(input.value);

    const query: Record<string, unknown> = {
      name: input.name,
      environment: input.environment,
    };
    if (wsId) {
      query.workspaceId = wsId;
    }

    const secret = await SecretModel.findOneAndUpdate(
      query,
      {
        workspaceId: wsId,
        name: input.name,
        environment: input.environment,
        encryptedValue: encrypted.encryptedValue,
        iv: encrypted.iv,
        tag: encrypted.tag,
        kekVersion: encrypted.kekVersion,
        createdBy: uId,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (!secret) {
      throw new Error('Failed to create or update secret');
    }

    await createAuditLog({
      action: 'SECRET_CREATED',
      workspaceId: wsId?.toString(),
      userId: uId?.toString(),
      resource: 'Secret',
      resourceId: secret._id.toString(),
      metadata: {
        name: input.name,
        environment: input.environment,
        kekVersion: encrypted.kekVersion,
      },
    });

    return secret;
  }

  /**
   * Retrieve and decrypt a secret value with audit logging
   */
  public async getSecretValue(
    secretId: string | Types.ObjectId,
    userId?: string | Types.ObjectId,
    ipAddress?: string
  ): Promise<{ secret: ISecret; plaintextValue: string } | null> {
    const secret = await SecretModel.findByIdAndUpdate(
      secretId,
      {
        $inc: { accessCount: 1 },
        accessedAt: new Date(),
      },
      { new: true }
    );

    if (!secret) return null;

    const plaintextValue = await this.vault.decrypt({
      encryptedValue: secret.encryptedValue,
      iv: secret.iv,
      tag: secret.tag,
      kekVersion: secret.kekVersion,
    });

    await createAuditLog({
      action: 'SECRET_ACCESSED',
      workspaceId: secret.workspaceId?.toString(),
      userId: userId?.toString(),
      resource: 'Secret',
      resourceId: secret._id.toString(),
      metadata: {
        name: secret.name,
        environment: secret.environment,
        accessCount: secret.accessCount,
      },
      ipAddress,
    });

    return { secret, plaintextValue };
  }

  /**
   * Rotate a secret value and/or re-encrypt under latest KEK
   */
  public async rotateSecret(
    secretId: string | Types.ObjectId,
    newValue: string,
    userId?: string | Types.ObjectId
  ): Promise<ISecret | null> {
    const secret = await SecretModel.findById(secretId);
    if (!secret) return null;

    const encrypted = await this.vault.encrypt(newValue);

    secret.encryptedValue = encrypted.encryptedValue;
    secret.iv = encrypted.iv;
    secret.tag = encrypted.tag;
    secret.kekVersion = encrypted.kekVersion;
    await secret.save();

    await createAuditLog({
      action: 'SECRET_ROTATED',
      workspaceId: secret.workspaceId?.toString(),
      userId: userId?.toString(),
      resource: 'Secret',
      resourceId: secret._id.toString(),
      metadata: {
        name: secret.name,
        environment: secret.environment,
        kekVersion: encrypted.kekVersion,
      },
    });

    return secret;
  }

  /**
   * List secret metadata (sanitized, values omitted)
   */
  public async listSecrets(
    workspaceId?: string | Types.ObjectId,
    environment?: 'development' | 'staging' | 'production'
  ): Promise<ISecret[]> {
    const query: Record<string, unknown> = {};
    if (workspaceId) {
      query.workspaceId = new Types.ObjectId(workspaceId.toString());
    }
    if (environment) {
      query.environment = environment;
    }

    return SecretModel.find(query)
      .select('-encryptedValue -iv -tag')
      .sort({ name: 1, environment: 1 });
  }

  /**
   * Delete a secret
   */
  public async deleteSecret(
    secretId: string | Types.ObjectId,
    userId?: string | Types.ObjectId
  ): Promise<boolean> {
    const secret = await SecretModel.findByIdAndDelete(secretId);
    if (!secret) return false;

    await createAuditLog({
      action: 'SECRET_DELETED',
      workspaceId: secret.workspaceId?.toString(),
      userId: userId?.toString(),
      resource: 'Secret',
      resourceId: secret._id.toString(),
      metadata: {
        name: secret.name,
        environment: secret.environment,
      },
    });

    return true;
  }
}

export const secretsService = new SecretsService();
