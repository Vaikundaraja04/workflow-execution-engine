import { Router } from 'express';
import { secretsService } from '../../services/secretsService.js';
import { requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import type { Request, Response, NextFunction } from 'express';

export function createSecretsRouter(): Router {
  const router = Router({ mergeParams: true });

  /**
   * @route GET /api/v1/secrets
   * @desc List secret metadata (sanitized, values omitted)
   * @access Private (requires SECRETS_MANAGE)
   */
  router.get(
    '/',
    requirePermission('SECRETS_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const environment = req.query.environment as 'development' | 'staging' | 'production' | undefined;
        const secrets = await secretsService.listSecrets(workspaceId, environment);
        res.json(secrets);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route POST /api/v1/secrets
   * @desc Create or update an encrypted secret
   * @access Private (requires SECRETS_MANAGE)
   */
  router.post(
    '/',
    requirePermission('SECRETS_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const { name, environment, value } = req.body;

        if (!name || !environment || !value) {
          return res.status(400).json({ error: 'Missing required fields: name, environment, value' });
        }

        const secret = await secretsService.setSecret({
          workspaceId,
          name,
          environment: environment as 'development' | 'staging' | 'production',
          value,
          userId,
        });

        // Return only metadata, not the plaintext value
        const { encryptedValue, iv, tag, ...metadata } = secret.toObject();
        res.json(metadata);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route GET /api/v1/secrets/:id
   * @desc Retrieve and decrypt a secret value
   * @access Private (requires SECRETS_MANAGE)
   */
  router.get(
    '/:id',
    requirePermission('SECRETS_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const id = req.params.id as string;
        const result = await secretsService.getSecretValue(
          id,
          userId,
          req.ip
        );

        if (!result) {
          return res.status(404).json({ error: 'Secret not found' });
        }

        const { secret, plaintextValue } = result;
        // Return the secret metadata and the plaintext value
        const { encryptedValue, iv, tag, ...metadata } = secret.toObject();
        res.json({
          ...metadata,
          value: plaintextValue,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route POST /api/v1/secrets/:id/rotate
   * @desc Rotate a secret value
   * @access Private (requires SECRETS_MANAGE)
   */
  router.post(
    '/:id/rotate',
    requirePermission('SECRETS_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const id = req.params.id as string;
        const { value } = req.body;

        if (!value) {
          return res.status(400).json({ error: 'Missing required field: value' });
        }

        const secret = await secretsService.rotateSecret(
          id,
          value,
          userId
        );

        if (!secret) {
          return res.status(404).json({ error: 'Secret not found' });
        }

        // Return only metadata, not the plaintext value
        const { encryptedValue, iv, tag, ...metadata } = secret.toObject();
        res.json(metadata);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route DELETE /api/v1/secrets/:id
   * @desc Delete a secret
   * @access Private (requires SECRETS_MANAGE)
   */
  router.delete(
    '/:id',
    requirePermission('SECRETS_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const id = req.params.id as string;
        const deleted = await secretsService.deleteSecret(
          id,
          userId
        );

        if (!deleted) {
          return res.status(404).json({ error: 'Secret not found' });
        }

        res.json({ success: true });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export default createSecretsRouter;