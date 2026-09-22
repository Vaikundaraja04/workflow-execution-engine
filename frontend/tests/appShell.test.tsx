import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { AppShell } from '@/components/layout/AppShell';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const mockRouter = { push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() };

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => mockRouter,
}));

vi.mock('@/services/workspaceApi', () => ({
  workspaceApi: {
    listWorkspaces: vi.fn().mockResolvedValue([]),
    getWorkspace: vi.fn(),
  },
}));

vi.mock('@/services/authService', () => ({
  authService: { logout: vi.fn() },
}));

describe('AppShell', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'user-1', email: 'test@example.com' },
      accessToken: 'token',
      refreshToken: 'refresh',
      defaultWorkspaceId: 'workspace-1',
      isAuthenticated: true,
      isLoading: false,
    });
    useWorkspaceStore.setState({
      currentWorkspace: null,
      workspaces: [],
      currentRole: 'OWNER',
      isLoading: false,
      error: null,
    });
  });

  it('renders grouped navigation linking every major section', () => {
    render(
      <AppShell>
        <div>shell content</div>
      </AppShell>
    );

    expect(screen.getAllByText('Dashboard').length).toBeGreaterThan(0);

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    ['/dashboard', '/workflows', '/executions', '/dead-letters', '/security', '/operations', '/platform', '/customer'].forEach(
      (href) => expect(hrefs).toContain(href)
    );
  });

  it('renders children inside the shell with account controls', () => {
    render(
      <AppShell>
        <div>shell content</div>
      </AppShell>
    );

    expect(screen.getByText('shell content')).toBeInTheDocument();
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('does not render children when unauthenticated', () => {
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false });

    render(
      <AppShell>
        <div>shell content</div>
      </AppShell>
    );

    expect(screen.queryByText('shell content')).not.toBeInTheDocument();
  });
});
