import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRegionMiddleware } from '../src/middleware/regionMiddleware.js';
import type { RegionRequest } from '../src/middleware/regionMiddleware.js';
import { RegionService } from '../src/services/regionService.js';
import type { Response, NextFunction } from 'express';

describe('Global Routing Middleware', () => {
  let mockRegionService: any;
  let mockReq: Partial<RegionRequest>;
  let mockRes: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockRegionService = {
      getWorkspaceRegion: vi.fn(),
    };
    mockReq = {
      headers: {},
      params: {},
      query: {},
    };
    mockRes = {
      setHeader: vi.fn(),
    };
    nextFunction = vi.fn();
  });

  it('should use x-region header if present', async () => {
    mockReq.headers = { 'x-region': 'eu-west-1' };
    const middleware = createRegionMiddleware(mockRegionService, 'us-east-1');

    await middleware(mockReq as RegionRequest, mockRes as Response, nextFunction);

    expect(mockReq.targetRegion).toBe('eu-west-1');
    expect(mockReq.isCrossRegion).toBe(true);
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Served-By-Region', 'us-east-1');
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Target-Region', 'eu-west-1');
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should look up workspace region if header is missing', async () => {
    mockReq.params = { workspaceId: 'ws-123' };
    mockRegionService.getWorkspaceRegion.mockResolvedValue('ap-southeast-1');

    const middleware = createRegionMiddleware(mockRegionService, 'us-east-1');

    await middleware(mockReq as RegionRequest, mockRes as Response, nextFunction);

    expect(mockRegionService.getWorkspaceRegion).toHaveBeenCalledWith('ws-123');
    expect(mockReq.targetRegion).toBe('ap-southeast-1');
    expect(mockReq.isCrossRegion).toBe(true);
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should default to currentRegion if neither header nor workspace is provided', async () => {
    const middleware = createRegionMiddleware(mockRegionService, 'us-east-1');

    await middleware(mockReq as RegionRequest, mockRes as Response, nextFunction);

    expect(mockReq.targetRegion).toBe('us-east-1');
    expect(mockReq.isCrossRegion).toBe(false);
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Served-By-Region', 'us-east-1');
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Target-Region', 'us-east-1');
    expect(nextFunction).toHaveBeenCalled();
  });
});
