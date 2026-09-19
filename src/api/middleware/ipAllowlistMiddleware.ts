import type { Request, Response, NextFunction } from 'express';
import { WorkspaceSecurityPolicyModel } from '../../models/WorkspaceSecurityPolicyModel.js';
import { getWorkspaceContext } from './requirePermission.js';

export function ipToLong(ip: string): number {
  return ip
    .split('.')
    .reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0);
}

export function isIpInCidr(ip: string, cidr: string): boolean {
  if (!cidr) return false;
  if (cidr.includes('/')) {
    const [range, bitsStr] = cidr.split('/');
    if (!range || !bitsStr) return false;
    const bits = parseInt(bitsStr, 10);
    if (isNaN(bits) || bits < 0 || bits > 32) return false;

    // IPv4 CIDR match
    if (!range.includes('.') || !ip.includes('.')) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    const ipLong = ipToLong(ip);
    const rangeLong = ipToLong(range);
    return (ipLong & mask) === (rangeLong & mask);
  }
  return ip === cidr;
}

export function isIpAllowed(clientIp: string, allowlist: string[] | undefined): boolean {
  if (!allowlist || allowlist.length === 0) return true;

  // Normalize IPv6 mapped IPv4 address (e.g. ::ffff:127.0.0.1 -> 127.0.0.1)
  const normalizedIp = clientIp.startsWith('::ffff:')
    ? clientIp.substring(7)
    : clientIp;

  for (const entry of allowlist) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (trimmed === '*' || trimmed === '0.0.0.0/0') return true;
    if (isIpInCidr(normalizedIp, trimmed)) return true;
    if (clientIp === trimmed || normalizedIp === trimmed) return true;
  }

  return false;
}

export function createIpAllowlistMiddleware() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      let workspaceId: string | undefined;
      try {
        const ctx = getWorkspaceContext(req);
        workspaceId = ctx.workspaceId;
      } catch {
        workspaceId = (req as unknown as { user?: { workspaceId?: string } }).user?.workspaceId;
      }

      if (!workspaceId) {
        return next();
      }

      const policy = await WorkspaceSecurityPolicyModel.findOne({ workspaceId });
      if (!policy || !policy.ipAllowlistEnabled || !policy.ipAllowlist || policy.ipAllowlist.length === 0) {
        return next();
      }

      const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
      if (!isIpAllowed(clientIp, policy.ipAllowlist)) {
        return res.status(403).json({
          error: {
            code: 'IP_NOT_ALLOWED',
            message: `Access from IP ${clientIp} is not authorized by the workspace security policy`,
          },
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
