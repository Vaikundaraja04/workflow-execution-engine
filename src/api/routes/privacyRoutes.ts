import { Router } from 'express';
import { privacyService } from '../../services/privacyService.js';
import { requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import type { Request, Response, NextFunction } from 'express';

export function createPrivacyRouter(): Router {
  const router = Router({ mergeParams: true });

  /**
   * @route POST /api/v1/privacy/export
   * @desc Request GDPR data export package
   * @access Private
   */
  router.post(
    '/export',
    requirePermission('PRIVACY_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const result = await privacyService.requestDataExport(userId, workspaceId);
        res.json(result);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route POST /api/v1/privacy/delete-request
   * @desc Request Right to be Forgotten account erasure
   * @access Private
   */
  router.post(
    '/delete-request',
    requirePermission('PRIVACY_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const { immediate } = req.body;

        const result = await privacyService.requestUserDeletion(
          userId,
          workspaceId,
          immediate === true
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route GET /api/v1/privacy/status
   * @desc Get privacy requests for current user
   * @access Private
   */
  router.get(
    '/status',
    requirePermission('PRIVACY_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const requests = await privacyService.getUserPrivacyRequests(userId);
        res.json(requests);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route GET /api/v1/privacy/preferences
   * @desc Get user privacy preferences
   * @access Private
   */
  router.get(
    '/preferences',
    requirePermission('PRIVACY_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const prefs = await privacyService.getPrivacyPreferences(userId);
        res.json(prefs);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route PUT /api/v1/privacy/preferences
   * @desc Update user privacy preferences
   * @access Private
   */
  router.put(
    '/preferences',
    requirePermission('PRIVACY_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const { analyticsConsent, marketingConsent, diagnosticsConsent } = req.body;
        const prefs = await privacyService.updatePrivacyPreferences(userId, {
          analyticsConsent,
          marketingConsent,
          diagnosticsConsent,
        });
        res.json(prefs);
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export default createPrivacyRouter;