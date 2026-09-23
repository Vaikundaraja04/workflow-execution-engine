import { Router } from 'express';
import { sessionService } from '../../services/sessionService.js';
import { mfaService } from '../../services/mfaService.js';
import { createAuditLog } from '../../services/auditService.js';
import { WorkspaceSecurityPolicyModel } from '../../models/WorkspaceSecurityPolicyModel.js';
import { requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import type { Request, Response, NextFunction } from 'express';

export function createSessionRouter(): Router {
  const router = Router({ mergeParams: true });

  /**
   * @route GET /api/v1/sessions
   * @desc List active sessions for the current user
   * @access Private (requires SECURITY_READ)
   */
  router.get(
    '/',
    requirePermission('SECURITY_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId, sessionId } = getAuthUser(req);
        const sessions = await sessionService.listActiveSessions(userId, sessionId);
        res.json(sessions);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route POST /api/v1/sessions/:id/revoke
   * @desc Revoke a specific session
   * @access Private (requires SECURITY_MANAGE)
   */
  router.post(
    '/:id/revoke',
    requirePermission('SECURITY_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = getAuthUser(req);
        const id = req.params.id as string;
        const { reason } = req.body;

        const revoked = await sessionService.revokeSessionById(userId, id);

        if (!revoked) {
          return res.status(404).json({ error: 'Session not found' });
        }

        await createAuditLog({
          action: 'SESSION_REVOKED',
          userId,
          resource: 'session',
          resourceId: id,
          metadata: { reason: reason || 'User initiated remote logout' },
        });

        res.json({ revoked: true, sessionId: id });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route POST /api/v1/sessions/revoke-others
   * @desc Revoke all other active sessions for current user
   * @access Private (requires SECURITY_MANAGE)
   */
  router.post(
    '/revoke-others',
    requirePermission('SECURITY_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId, sessionId } = getAuthUser(req);
        if (!sessionId) {
          return res.status(400).json({
            error: { code: 'INVALID_REQUEST', message: 'The current session could not be identified' },
          });
        }

        const count = await sessionService.revokeOtherSessions(userId, sessionId);

        await createAuditLog({
          action: 'SESSION_REVOKED',
          userId,
          resource: 'session',
          metadata: { reason: 'Revoked all other sessions', count },
        });

        res.json({ message: `Successfully revoked ${count} other sessions`, count });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route GET /api/v1/security/policy
   * @desc Get workspace security policy & IP allowlists
   * @access Private (requires SECURITY_READ)
   */
  router.get(
    '/policy',
    requirePermission('SECURITY_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        let policy = await WorkspaceSecurityPolicyModel.findOne({ workspaceId });
        if (!policy) {
          policy = await WorkspaceSecurityPolicyModel.create({ workspaceId });
        }
        res.json(policy);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route PUT /api/v1/security/policy
   * @desc Update workspace security policy & IP allowlists
   * @access Private (requires SECURITY_MANAGE)
   */
  router.put(
    '/policy',
    requirePermission('SECURITY_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const {
          ipAllowlistEnabled,
          ipAllowlist,
          enforceMfa,
          sessionTimeoutMinutes,
          maxConcurrentSessions,
          passwordMinLength,
          passwordRequireUppercase,
          passwordRequireNumbers,
          passwordRequireSymbols,
          passwordExpiryDays,
          passwordHistoryCount,
        } = req.body;

        const policy = await WorkspaceSecurityPolicyModel.findOneAndUpdate(
          { workspaceId },
          {
            ipAllowlistEnabled,
            ipAllowlist,
            enforceMfa,
            sessionTimeoutMinutes,
            maxConcurrentSessions,
            passwordMinLength,
            passwordRequireUppercase,
            passwordRequireNumbers,
            passwordRequireSymbols,
            passwordExpiryDays,
            passwordHistoryCount,
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        res.json(policy);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route POST /api/v1/auth/mfa/setup
   * @desc Generate TOTP setup parameters for MFA
   * @access Private
   */
  router.post(
    '/mfa/setup',
    requirePermission('PRIVACY_MANAGE'), // Note: Using PRIVACY_MANAGE as it's related to user security
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const email = (req as unknown as { user?: { email?: string } }).user?.email || 'user@example.com';
        const setup = mfaService.generateMfaSetup(email);
        res.json(setup);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route POST /api/v1/auth/mfa/verify
   * @desc Verify MFA TOTP code
   * @access Private
   */
  router.post(
    '/mfa/verify',
    requirePermission('PRIVACY_MANAGE'), // Note: Using PRIVACY_MANAGE as it's related to user security
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const { secret, token } = req.body;
        if (!secret || !token) {
          return res.status(400).json({ error: 'Missing secret or token' });
        }

        const isValid = mfaService.verifyToken(secret, token);
        res.json({ verified: isValid });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export default createSessionRouter;