import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { apiClient } from '@/services/apiClient';
import { agentMarketplaceApi } from '@/services/agentMarketplaceApi';
import { AgentCard } from '@/features/agents/marketplace/AgentCard';
import { AgentInstallModal } from '@/features/agents/marketplace/AgentInstallModal';
import { AgentReviewPanel } from '@/features/agents/marketplace/AgentReviewPanel';
import type { AgentMarketplaceListingDTO } from '@/types/agentMarketplace';

vi.mock('@/services/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

type MockFn = ReturnType<typeof vi.fn>;

const client = apiClient as unknown as {
  get: MockFn;
  post: MockFn;
  put: MockFn;
  delete: MockFn;
};

const workspaceHeaders = { headers: { 'X-Workspace-Id': 'workspace-1' } };

const listingFixture: AgentMarketplaceListingDTO = {
  _id: '507f1f77bcf86cd799439051',
  workspaceId: '507f1f77bcf86cd799439052',
  agentId: '507f1f77bcf86cd799439053',
  publisherId: '507f1f77bcf86cd799439054',
  name: 'Incident Triage Agent',
  description: 'Summarises incidents and proposes remediation steps.',
  category: 'Operations',
  tags: ['ops', 'incidents'],
  visibility: 'PUBLIC',
  status: 'PUBLISHED',
  pricing: { model: 'FREE', priceUSD: 0, currency: 'USD' },
  statistics: { views: 10, installs: 3, executions: 7, downloads: 3 },
  installCount: 3,
  executionCount: 7,
  rating: { average: 4.5, count: 2 },
  versionCount: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};
describe('Phase 12.7 agent marketplace API service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('searches agents with workspace header and filter params', async () => {
    client.get.mockResolvedValue({
      data: { data: { items: [listingFixture], pagination: { page: 1, limit: 20, totalCount: 1, totalPages: 1 } } },
    });

    const result = await agentMarketplaceApi.searchAgents('workspace-1', {
      q: 'incident',
      category: 'Operations',
      sortBy: 'rating',
    });

    expect(client.get).toHaveBeenCalledWith('/api/v1/agent-marketplace/agents', {
      headers: { 'X-Workspace-Id': 'workspace-1' },
      params: { q: 'incident', category: 'Operations', sortBy: 'rating' },
    });
    expect(result.items).toHaveLength(1);
    expect(result.pagination.totalCount).toBe(1);
  });

  it('loads listing details and versions through the envelope', async () => {
    client.get.mockResolvedValue({ data: { data: listingFixture } });
    await agentMarketplaceApi.getAgentDetails('listing-1', 'workspace-1');
    expect(client.get).toHaveBeenCalledWith(
      '/api/v1/agent-marketplace/agents/listing-1',
      workspaceHeaders
    );

    client.get.mockResolvedValue({ data: { data: [] } });
    await agentMarketplaceApi.listVersions('listing-1', 'workspace-1');
    expect(client.get).toHaveBeenCalledWith(
      '/api/v1/agent-marketplace/agents/listing-1/versions',
      workspaceHeaders
    );
  });
});
describe('Phase 12.7 agent marketplace lifecycle API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes, installs and uninstalls agents with the workspace header', async () => {
    client.post.mockResolvedValue({ data: { data: listingFixture } });
    await agentMarketplaceApi.publishAgent('listing-1', 'workspace-1');
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/agent-marketplace/agents/listing-1/publish',
      {},
      workspaceHeaders
    );

    client.post.mockResolvedValue({
      data: { data: { install: { _id: 'install-1', status: 'ACTIVE' }, agent: { _id: 'agent-2', name: 'x' } } },
    });
    await agentMarketplaceApi.installAgent('listing-1', { temperature: 0.3 }, 'workspace-1');
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/agent-marketplace/agents/listing-1/install',
      { configuration: { temperature: 0.3 } },
      workspaceHeaders
    );

    client.delete.mockResolvedValue({ data: { data: { uninstalled: true, localAgentId: 'agent-2' } } });
    const uninstall = await agentMarketplaceApi.uninstallAgent('listing-1', 'workspace-1');
    expect(client.delete).toHaveBeenCalledWith(
      '/api/v1/agent-marketplace/agents/listing-1/install',
      workspaceHeaders
    );
    expect(uninstall.uninstalled).toBe(true);
  });

  it('submits reviews and rollbacks', async () => {
    client.post.mockResolvedValue({
      data: { data: { review: { _id: 'review-1', rating: 4 }, rating: { average: 4, count: 1 } } },
    });
    const review = await agentMarketplaceApi.createReview('listing-1', 4, 'Solid', 'workspace-1');
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/agent-marketplace/agents/listing-1/reviews',
      { rating: 4, review: 'Solid' },
      workspaceHeaders
    );
    expect(review.rating.average).toBe(4);

    client.post.mockResolvedValue({ data: { data: { _id: 'version-3', versionNumber: 3 } } });
    await agentMarketplaceApi.rollbackVersion('listing-1', 1, 'workspace-1');
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/agent-marketplace/agents/listing-1/rollback',
      { version: 1 },
      workspaceHeaders
    );
  });
});
describe('Phase 12.7 agent marketplace components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders agent cards with rating and installs, and triggers install', () => {
    const onInstall = vi.fn();
    render(
      <AgentCard
        listing={listingFixture}
        installed={false}
        canInstall
        onView={vi.fn()}
        onInstall={onInstall}
      />
    );

    expect(screen.getByText('Incident Triage Agent')).toBeInTheDocument();
    expect(screen.getByText('4.5 (2)')).toBeInTheDocument();
    expect(screen.getByText('3 installs')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(onInstall).toHaveBeenCalledWith(listingFixture);
  });

  it('shows the installed badge instead of the install button when installed', () => {
    render(
      <AgentCard listing={listingFixture} installed canInstall={false} onView={vi.fn()} onInstall={vi.fn()} />
    );

    expect(screen.getByText('installed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
  });

  it('guards reviews behind an active installation and submits them when installed', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <AgentReviewPanel reviews={[]} canReview={false} onSubmit={onSubmit} />
    );
    expect(screen.getByText('Install this agent to leave a verified review.')).toBeInTheDocument();

    rerender(<AgentReviewPanel reviews={[]} canReview onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'rate-4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));
    expect(onSubmit).toHaveBeenCalledWith(4, '');
  });

  it('submits parsed install configuration from the install modal', () => {
    const onConfirm = vi.fn();
    render(
      <AgentInstallModal
        listing={listingFixture}
        open
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { value: '0.3' } });
    fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    expect(onConfirm).toHaveBeenCalledWith({ temperature: 0.3, maxTurns: 9 });
  });
});