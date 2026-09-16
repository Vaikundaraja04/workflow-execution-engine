import { Router } from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import {
  authenticateSCIMToken,
  createSCIMUser,
  deleteSCIMUser,
  getSCIMUser,
  getServiceProviderConfig,
  listSCIMUsers,
  updateSCIMUser,
} from '../../services/scimService.js';

interface RequestWithSCIMWorkspace extends Request {
  scimWorkspaceId?: string;
}

/**
 * SCIM Bearer Token Authentication Middleware.
 */
export function requireSCIMAuth(): RequestHandler {
  return (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
          status: '401',
          detail: 'SCIM Bearer authentication required',
        });
        return;
      }

      const rawToken = authHeader.slice('Bearer '.length).trim();
      const workspaceId = await authenticateSCIMToken(rawToken);
      (req as RequestWithSCIMWorkspace).scimWorkspaceId = workspaceId;
      next();
    } catch {
      res.status(401).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '401',
        detail: 'Invalid or expired SCIM bearer token',
      });
    }
  }) as RequestHandler;
}

function getSCIMWorkspaceId(req: Request): string {
  const wsId = (req as RequestWithSCIMWorkspace).scimWorkspaceId;
  if (!wsId) {
    throw new Error('SCIM_UNAUTHORIZED');
  }
  return wsId;
}

function getRouteUserId(req: Request): string {
  const userId = req.params.id;
  if (!userId || typeof userId !== 'string') {
    throw new Error('SCIM_USER_NOT_FOUND');
  }
  return userId;
}

function getBaseUrl(req: Request): string {
  const protocol = req.protocol || 'http';
  const host = req.get('host') || 'localhost:3000';
  return `${protocol}://${host}`;
}

export function createSCIMRouter(): Router {
  const router = Router();
  const scimAuth = requireSCIMAuth();

  // 1. ServiceProviderConfig (Public / standard metadata)
  router.get('/ServiceProviderConfig', ((_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/scim+json');
    res.json(getServiceProviderConfig());
  }) as RequestHandler);

  // Apply SCIM Authentication for all user provisioning endpoints
  router.use('/Users', scimAuth);

  // 2. List Users (GET /scim/v2/Users)
  router.get('/Users', (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getSCIMWorkspaceId(req);
      const startIndex = req.query.startIndex ? parseInt(String(req.query.startIndex), 10) : undefined;
      const count = req.query.count ? parseInt(String(req.query.count), 10) : undefined;
      const filter = typeof req.query.filter === 'string' ? req.query.filter : undefined;

      const result = await listSCIMUsers(workspaceId, {
        startIndex,
        count,
        filter,
        baseUrl: getBaseUrl(req),
      });

      res.setHeader('Content-Type', 'application/scim+json');
      res.json(result);
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  // 3. Get User by ID (GET /scim/v2/Users/:id)
  router.get('/Users/:id', (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getSCIMWorkspaceId(req);
      const userId = getRouteUserId(req);
      const user = await getSCIMUser(workspaceId, userId, getBaseUrl(req));
      res.setHeader('Content-Type', 'application/scim+json');
      res.json(user);
    } catch (error) {
      if (error instanceof Error && error.message === 'SCIM_USER_NOT_FOUND') {
        res.status(404).json({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
          status: '404',
          detail: 'User not found in this workspace',
        });
        return;
      }
      next(error);
    }
  }) as RequestHandler);

  // 4. Provision User (POST /scim/v2/Users)
  router.post('/Users', (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getSCIMWorkspaceId(req);
      const user = await createSCIMUser(workspaceId, req.body || {}, getBaseUrl(req));
      res.setHeader('Content-Type', 'application/scim+json');
      res.status(201).json(user);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'SCIM_CONFLICT') {
          res.status(409).json({
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '409',
            detail: 'User already exists in this workspace',
          });
          return;
        }
        if (error.message === 'INVALID_REQUEST') {
          res.status(400).json({
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '400',
            detail: 'Invalid user payload: valid userName or email is required',
          });
          return;
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // 5. Update User via PATCH (PATCH /scim/v2/Users/:id)
  router.patch('/Users/:id', (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getSCIMWorkspaceId(req);
      const userId = getRouteUserId(req);
      const user = await updateSCIMUser(workspaceId, userId, req.body || {}, getBaseUrl(req));
      res.setHeader('Content-Type', 'application/scim+json');
      res.json(user);
    } catch (error) {
      if (error instanceof Error && error.message === 'SCIM_USER_NOT_FOUND') {
        res.status(404).json({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
          status: '404',
          detail: 'User not found in this workspace',
        });
        return;
      }
      next(error);
    }
  }) as RequestHandler);

  // 6. Update User via PUT (PUT /scim/v2/Users/:id)
  router.put('/Users/:id', (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getSCIMWorkspaceId(req);
      const userId = getRouteUserId(req);
      const user = await updateSCIMUser(workspaceId, userId, req.body || {}, getBaseUrl(req));
      res.setHeader('Content-Type', 'application/scim+json');
      res.json(user);
    } catch (error) {
      if (error instanceof Error && error.message === 'SCIM_USER_NOT_FOUND') {
        res.status(404).json({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
          status: '404',
          detail: 'User not found in this workspace',
        });
        return;
      }
      next(error);
    }
  }) as RequestHandler);

  // 7. Deprovision User (DELETE /scim/v2/Users/:id)
  router.delete('/Users/:id', (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getSCIMWorkspaceId(req);
      const userId = getRouteUserId(req);
      await deleteSCIMUser(workspaceId, userId);
      res.status(204).send();
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'SCIM_USER_NOT_FOUND') {
          res.status(404).json({
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '404',
            detail: 'User not found in this workspace',
          });
          return;
        }
        if (error.message === 'OWNER_ROLE_IMMUTABLE') {
          res.status(403).json({
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '403',
            detail: 'Cannot deprovision workspace OWNER through SCIM',
          });
          return;
        }
      }
      next(error);
    }
  }) as RequestHandler);

  return router;
}

export const createScimRouter = createSCIMRouter;