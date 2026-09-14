import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import type { AuthConfig } from './jwt.service.js';
import {
  issueTokens,
  loginUser,
  registerUser,
  revokeRefreshTokenFamily,
  rotateRefreshToken,
  toUserView,
} from './auth.service.js';

const emailSchema = z.string().trim().toLowerCase().email().max(254);

const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(128),
}).strict();

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
}).strict();

const refreshSchema = z.object({
  refreshToken: z.string().trim().min(1).max(512),
}).strict();

export interface AuthController {
  register: RequestHandler;
  login: RequestHandler;
  refresh: RequestHandler;
  logout: RequestHandler;
}

export function createAuthController(config: AuthConfig): AuthController {
  return {
    register: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = registerSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
          return;
        }
        const user = await registerUser(parsed.data.email, parsed.data.password);
        res.status(201).json(toUserView(user));
      } catch (error) {
        next(error);
      }
    },
    login: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
          return;
        }
        const user = await loginUser(parsed.data.email, parsed.data.password);
        const tokens = await issueTokens(config, user._id, user.email);
        res.json(tokens);
      } catch (error) {
        next(error);
      }
    },
    refresh: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = refreshSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
          return;
        }
        const tokens = await rotateRefreshToken(config, parsed.data.refreshToken);
        res.json(tokens);
      } catch (error) {
        next(error);
      }
    },
    logout: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = refreshSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
          return;
        }
        await revokeRefreshTokenFamily(parsed.data.refreshToken);
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  };
}