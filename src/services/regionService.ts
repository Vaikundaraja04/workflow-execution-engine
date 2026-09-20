import { RegionModel, type IRegion } from '../models/RegionModel.js';
import { WorkspaceModel } from '../models/WorkspaceModel.js';

export interface RegionAssignmentStrategy {
  selectRegion(workspaceSlug: string, preferredRegion?: string): Promise<string>;
}

export class DefaultRegionStrategy implements RegionAssignmentStrategy {
  async selectRegion(workspaceSlug: string, preferredRegion?: string): Promise<string> {
    if (preferredRegion) {
      const region = await RegionModel.findOne({ code: preferredRegion, status: 'ACTIVE' });
      if (region) return region.code;
    }
    // Fallback: choose the first active region or default to 'us-east-1'
    const activeRegion = await RegionModel.findOne({ status: 'ACTIVE' });
    return activeRegion ? activeRegion.code : 'us-east-1';
  }
}

export class RegionService {
  private strategy: RegionAssignmentStrategy;

  constructor(strategy?: RegionAssignmentStrategy) {
    this.strategy = strategy || new DefaultRegionStrategy();
  }

  async listActiveRegions(): Promise<IRegion[]> {
    return RegionModel.find({ status: 'ACTIVE' });
  }

  async getRegionByCode(code: string): Promise<IRegion | null> {
    return RegionModel.findOne({ code });
  }

  async assignRegionToWorkspace(workspaceId: string, preferredRegion?: string): Promise<string> {
    const workspace = await WorkspaceModel.findById(workspaceId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }
    const regionCode = await this.strategy.selectRegion(workspace.slug, preferredRegion);
    workspace.region = regionCode;
    await workspace.save();
    return regionCode;
  }

  async getWorkspaceRegion(workspaceId: string): Promise<string> {
    const workspace = await WorkspaceModel.findById(workspaceId);
    if (!workspace || !workspace.region) {
      return 'us-east-1'; // default region
    }
    return workspace.region;
  }
}
