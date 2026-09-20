import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultRegionStrategy } from '../src/services/regionService.js';
import { RegionModel } from '../src/models/RegionModel.js';

vi.mock('../src/models/RegionModel.js');

describe('High Availability & Failover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fallback to active region when preferred region is not available', async () => {
    // Mock RegionModel.findOne: first call for preferred region returns null, second call for active returns us-east-1
    (RegionModel.findOne as any).mockImplementation((query: any) => {
      if (query.code === 'eu-central-1') {
        return Promise.resolve(null); // Not found or inactive
      }
      if (query.status === 'ACTIVE') {
        return Promise.resolve({ code: 'us-east-1', status: 'ACTIVE' });
      }
      return Promise.resolve(null);
    });

    const strategy = new DefaultRegionStrategy();
    const region = await strategy.selectRegion('my-workspace', 'eu-central-1');

    expect(region).toBe('us-east-1');
  });

  it('should return default region us-east-1 if no active regions in database', async () => {
    (RegionModel.findOne as any).mockResolvedValue(null);

    const strategy = new DefaultRegionStrategy();
    const region = await strategy.selectRegion('my-workspace');

    expect(region).toBe('us-east-1');
  });
});
