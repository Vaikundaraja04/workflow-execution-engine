import { LocalEncryptedVault, type EncryptedPayload } from '../src/services/secrets/secretsVault.js';
import { SecretsService } from '../src/services/secretsService.js';
import { SecretModel } from '../src/models/SecretModel.js';
import { createAuditLog } from '../src/services/auditService.js';
import { Types } from 'mongoose';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock the SecretModel and createAuditLog
vi.mock('../src/models/SecretModel.js');
vi.mock('../src/services/auditService.js');

describe('LocalEncryptedVault', () => {
  const testMasterKey = '0000000000000000000000000000000000000000000000000000000000000000'; // 32 bytes hex
  let vault: LocalEncryptedVault;

  beforeEach(() => {
    // Set a fixed master key for testing via environment variable
    process.env.SECRETS_MASTER_KEY = testMasterKey;
    vault = new LocalEncryptedVault(undefined, 'v1');
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.SECRETS_MASTER_KEY;
  });

  describe('encrypt & decrypt', () => {
    it('should encrypt and decrypt a plaintext string correctly', async () => {
      const plaintext = 'my-secret-password-123!';

      const encrypted: EncryptedPayload = await vault.encrypt(plaintext, 'v1');

      // Check the structure of the encrypted payload
      expect(encrypted).toHaveProperty('encryptedValue');
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('tag');
      expect(encrypted).toHaveProperty('kekVersion', 'v1');

      // Ensure the encrypted value is not the same as plaintext
      expect(encrypted.encryptedValue).not.toBe(plaintext);

      // Decrypt and compare
      const decrypted = await vault.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should throw an error for unknown KEK version', async () => {
      const plaintext = 'test';
      await expect(vault.encrypt(plaintext, 'v2')).rejects.toThrow(
        `Master KEK version 'v2' not found in vault`
      );

      const encrypted = await vault.encrypt(plaintext, 'v1');
      // Tamper with the kekVersion to simulate an unknown version
      encrypted.kekVersion = 'v2';
      await expect(vault.decrypt(encrypted)).rejects.toThrow(
        `Master KEK version 'v2' not found in vault`
      );
    });

    it('should support key rotation by adding a new KEK version', async () => {
      const plaintext = 'rotate-me';
      const initialEncrypted = await vault.encrypt(plaintext, 'v1');

      // Add a new key version
      const newKeyHex = '1111111111111111111111111111111111111111111111111111111111111111'; // 32 bytes
      vault.addKeyVersion('v2', newKeyHex);

      // Encrypt with the new version
      const newEncrypted = await vault.encrypt(plaintext, 'v2');
      expect(newEncrypted.kekVersion).toBe('v2');

      // Decrypt with the new version should work
      const decryptedNew = await vault.decrypt(newEncrypted);
      expect(decryptedNew).toBe(plaintext);

      // The old version should still work
      const decryptedOld = await vault.decrypt(initialEncrypted);
      expect(decryptedOld).toBe(plaintext);
    });
  });
});

describe('SecretsService', () => {
  const mockWorkspaceId = new Types.ObjectId().toString();
  const mockUserId = new Types.ObjectId().toString();
  const secretsService = new SecretsService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('setSecret', () => {
    it('should create or update a secret and log audit', async () => {
      const input = {
        workspaceId: mockWorkspaceId,
        name: 'TEST_SECRET',
        environment: 'development' as const,
        value: 'super-secret-value',
        userId: mockUserId,
      };

      const mockSecret = {
        _id: new Types.ObjectId(),
        workspaceId: new Types.ObjectId(mockWorkspaceId),
        name: input.name,
        environment: input.environment,
        encryptedValue: 'encrypted',
        iv: 'iv',
        tag: 'tag',
        kekVersion: 'v1',
        createdBy: new Types.ObjectId(mockUserId),
        accessCount: 0,
        accessedAt: undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (SecretModel.findOneAndUpdate as any).mockResolvedValue(mockSecret);
      (createAuditLog as any).mockResolvedValue(undefined);

      const result = await secretsService.setSecret(input);

      expect(SecretModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          workspaceId: expect.any(Object),
          name: input.name,
          environment: input.environment,
        },
        {
          workspaceId: expect.any(Object),
          name: input.name,
          environment: input.environment,
          encryptedValue: expect.any(String),
          iv: expect.any(String),
          tag: expect.any(String),
          kekVersion: expect.any(String),
          createdBy: expect.any(Object),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SECRET_CREATED',
          workspaceId: mockWorkspaceId,
          userId: mockUserId,
          resource: 'Secret',
          resourceId: mockSecret._id.toString(),
          metadata: {
            name: input.name,
            environment: input.environment,
            kekVersion: expect.any(String),
          },
        })
      );
      expect(result).toMatchObject(mockSecret);
    });
  });

  describe('getSecretValue', () => {
    it('should retrieve and decrypt a secret value and log audit', async () => {
      const secretId = new Types.ObjectId();
      const mockSecret = {
        _id: secretId,
        workspaceId: new Types.ObjectId(mockWorkspaceId),
        name: 'TEST_SECRET',
        environment: 'development',
        encryptedValue: 'encrypted',
        iv: 'iv',
        tag: 'tag',
        kekVersion: 'v1',
        accessCount: 5,
        accessedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (SecretModel.findByIdAndUpdate as any).mockResolvedValue(mockSecret);

      // Mock the vault decrypt method
      const originalVault = secretsService['vault'];
      vi.spyOn(originalVault, 'decrypt').mockResolvedValue('decrypted-value');

      const result = await secretsService.getSecretValue(secretId.toString(), mockUserId, '192.168.1.1');

      expect(SecretModel.findByIdAndUpdate).toHaveBeenCalledWith(
        secretId.toString(),
        {
          $inc: { accessCount: 1 },
          accessedAt: expect.any(Date),
        },
        { new: true }
      );
      expect(result).toEqual({
        secret: mockSecret,
        plaintextValue: 'decrypted-value',
      });
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SECRET_ACCESSED',
          workspaceId: mockWorkspaceId,
          userId: mockUserId,
          resource: 'Secret',
          resourceId: secretId.toString(),
          metadata: {
            name: mockSecret.name,
            environment: mockSecret.environment,
            accessCount: 5, // original value before increment
          },
          ipAddress: '192.168.1.1',
        })
      );
    });

    it('should return null if secret not found', async () => {
      (SecretModel.findByIdAndUpdate as any).mockResolvedValue(null);

      const result = await secretsService.getSecretValue(new Types.ObjectId().toString());

      expect(result).toBeNull();
    });
  });

  describe('rotateSecret', () => {
    it('should rotate a secret value and log audit', async () => {
      const secretId = new Types.ObjectId();
      const newValue = 'new-secret-value';
      const mockSecret = {
        _id: secretId,
        workspaceId: new Types.ObjectId(mockWorkspaceId),
        name: 'TEST_SECRET',
        environment: 'development',
        encryptedValue: 'old-encrypted',
        iv: 'old-iv',
        tag: 'old-tag',
        kekVersion: 'v1',
        accessCount: 0,
        accessedAt: undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
        save: vi.fn(),
      };

      (SecretModel.findById as any).mockResolvedValue(mockSecret);

      // Mock the vault encrypt method
      const originalVault = secretsService['vault'];
      const mockEncrypted = {
        encryptedValue: 'new-encrypted',
        iv: 'new-iv',
        tag: 'new-tag',
        kekVersion: 'v1',
      };
      vi.spyOn(originalVault, 'encrypt').mockResolvedValue(mockEncrypted);
      (createAuditLog as any).mockResolvedValue(undefined);

      const result = await secretsService.rotateSecret(secretId.toString(), newValue, mockUserId);

      expect(SecretModel.findById).toHaveBeenCalledWith(secretId.toString());
      expect(originalVault.encrypt).toHaveBeenCalledWith(newValue);
      expect(mockSecret.save).toHaveBeenCalled();
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SECRET_ROTATED',
          workspaceId: mockWorkspaceId,
          userId: mockUserId,
          resource: 'Secret',
          resourceId: secretId.toString(),
          metadata: {
            name: mockSecret.name,
            environment: mockSecret.environment,
            kekVersion: 'v1',
          },
        })
      );
      expect(result).toMatchObject({
        ...mockSecret,
        encryptedValue: mockEncrypted.encryptedValue,
        iv: mockEncrypted.iv,
        tag: mockEncrypted.tag,
        kekVersion: mockEncrypted.kekVersion,
      });
    });

    it('should return null if secret not found', async () => {
      (SecretModel.findById as any).mockResolvedValue(null);

      const result = await secretsService.rotateSecret(new Types.ObjectId().toString(), 'new-value');

      expect(result).toBeNull();
    });
  });

  describe('listSecrets', () => {
    it('should list secret metadata without exposing encrypted values', async () => {
      const mockSecrets = [
        {
          _id: new Types.ObjectId(),
          name: 'SECRET_ONE',
          environment: 'development',
          kekVersion: 'v1',
          workspaceId: new Types.ObjectId(mockWorkspaceId),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          _id: new Types.ObjectId(),
          name: 'SECRET_TWO',
          environment: 'production',
          kekVersion: 'v1',
          workspaceId: new Types.ObjectId(mockWorkspaceId),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const selectMock = vi.fn().mockReturnThis();
      (SecretModel.find as any).mockReturnValue({
        select: selectMock,
        sort: vi.fn().mockResolvedValue(mockSecrets),
      });

      const result = await secretsService.listSecrets(mockWorkspaceId, 'development');

      expect(SecretModel.find).toHaveBeenCalledWith({
        workspaceId: expect.any(Object),
        environment: 'development',
      });
      expect(selectMock).toHaveBeenCalledWith('-encryptedValue -iv -tag');
      expect(result).toHaveLength(2);
      // Ensure the encrypted fields are not present (due to select)
      expect(result[0]).not.toHaveProperty('encryptedValue');
      expect(result[0]).not.toHaveProperty('iv');
      expect(result[0]).not.toHaveProperty('tag');
      expect(result[0]).toHaveProperty('name', 'SECRET_ONE');
      expect(result[0]).toHaveProperty('environment', 'development');
    });
  });

  describe('deleteSecret', () => {
    it('should delete a secret and log audit', async () => {
      const secretId = new Types.ObjectId();
      const mockSecret = {
        _id: secretId,
        name: 'TO_DELETE',
        workspaceId: new Types.ObjectId(mockWorkspaceId),
        environment: 'development',
      };

      (SecretModel.findByIdAndDelete as any).mockResolvedValue(mockSecret);
      (createAuditLog as any).mockResolvedValue(undefined);

      const result = await secretsService.deleteSecret(secretId.toString(), mockUserId);

      expect(SecretModel.findByIdAndDelete).toHaveBeenCalledWith(secretId.toString());
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SECRET_DELETED',
          workspaceId: mockWorkspaceId,
          userId: mockUserId,
          resource: 'Secret',
          resourceId: secretId.toString(),
          metadata: {
            name: mockSecret.name,
            environment: mockSecret.environment,
          },
        })
      );
      expect(result).toBe(true);
    });

    it('should return false if secret not found', async () => {
      (SecretModel.findByIdAndDelete as any).mockResolvedValue(null);

      const result = await secretsService.deleteSecret(new Types.ObjectId().toString());

      expect(result).toBe(false);
    });
  });
});