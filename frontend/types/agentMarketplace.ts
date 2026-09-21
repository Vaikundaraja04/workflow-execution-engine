export type AgentMarketplaceVisibility = 'PUBLIC' | 'PRIVATE' | 'WORKSPACE';
export type AgentMarketplaceStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type AgentMarketplaceSortBy = 'rating' | 'installs' | 'executions' | 'recent';
export type AgentPricingModel = 'FREE' | 'PAID';

export interface AgentMarketplaceListingDTO {
  _id: string;
  workspaceId: string;
  agentId: string;
  publisherId: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  visibility: AgentMarketplaceVisibility;
  status: AgentMarketplaceStatus;
  icon?: string;
  documentation?: string;
  pricing: { model: AgentPricingModel; priceUSD: number; currency: string };
  statistics: { views: number; installs: number; executions: number; downloads: number };
  installCount: number;
  executionCount: number;
  rating: { average: number; count: number };
  versionCount: number;
  latestVersion?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMarketplacePaginationDTO {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

export interface AgentMarketplaceSearchResultDTO {
  items: AgentMarketplaceListingDTO[];
  pagination: AgentMarketplacePaginationDTO;
}

export interface AgentMarketplaceSearchParams {
  q?: string;
  category?: string;
  tag?: string;
  publisherId?: string;
  minRating?: number;
  sortBy?: AgentMarketplaceSortBy;
  page?: number;
  limit?: number;
}

export interface AgentVersionDTO {
  _id: string;
  agentMarketplaceId: string;
  versionNumber: number;
  changeSummary: string;
  hash: string;
  toolConfiguration: Record<string, string>;
  governanceSnapshot: { reasonCodes?: string[]; modelChecked?: string };
  createdAt: string;
}

export interface AgentVersionComparisonDTO {
  from: { versionNumber: number; hash: string; createdAt: string };
  to: { versionNumber: number; hash: string; createdAt: string };
  identical: boolean;
  changedFields: string[];
  toolsAdded: string[];
  toolsRemoved: string[];
  governanceChanged: boolean;
}

export interface InstalledAgentDTO {
  _id: string;
  agentMarketplaceId: string;
  agentId: string;
  installedVersion: number;
  status: 'ACTIVE' | 'DISABLED' | 'UNINSTALLED';
  installedAt: string;
}
export interface PublisherProfileDTO {
  _id: string;
  userId: string;
  displayName: string;
  verified: boolean;
  publisherType: 'INDIVIDUAL' | 'ENTERPRISE';
  website?: string;
  stats: { publishedAgents: number; totalInstalls: number; averageRating: number };
}

export interface AgentReviewDTO {
  _id: string;
  agentMarketplaceId: string;
  userId: string;
  rating: number;
  review?: string;
  createdAt: string;
}

export interface AgentReviewListDTO {
  items: AgentReviewDTO[];
  pagination: AgentMarketplacePaginationDTO;
}

export interface AgentMarketplaceDetailsDTO {
  listing: AgentMarketplaceListingDTO;
  latestVersion: AgentVersionDTO | null;
  publisher: PublisherProfileDTO | null;
  install: InstalledAgentDTO | null;
  reviews: AgentReviewDTO[];
}

export interface AgentMarketplaceStatsDTO {
  listingId: string;
  status: AgentMarketplaceStatus;
  visibility: AgentMarketplaceVisibility;
  installs: { total: number; active: number };
  executions: number;
  statistics: { views: number; installs: number; executions: number; downloads: number };
  rating: { average: number; count: number };
  reviewCount: number;
  versionCount: number;
}

export interface InstallAgentConfigurationDTO {
  model?: string;
  temperature?: number;
  maxTurns?: number;
  toolsAllowed?: string[];
  memoryEnabled?: boolean;
}

export interface InstallAgentResultDTO {
  install: InstalledAgentDTO;
  agent: { _id: string; name: string; workspaceId: string; status: string };
}