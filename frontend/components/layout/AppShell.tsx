'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { NAV_GROUPS } from '@/components/layout/nav-config';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { Loading } from '@/components/ui/Loading';
import { cn } from '@/lib/utils';
import { authService } from '@/services/authService';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

function isItemActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}

function SidebarNav({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main navigation" className="flex-1 space-y-5 overflow-y-auto px-3 pb-6 pt-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isItemActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
                      active
                        ? 'bg-emerald-50 font-medium text-emerald-700'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    )}
                  >
                    <Icon
                      className={cn('h-4 w-4 shrink-0', active ? 'text-emerald-600' : 'text-gray-400')}
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarBrand() {
  return (
    <Link
      href="/dashboard"
      className="flex h-16 shrink-0 items-center gap-2 border-b border-gray-200 px-4"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-600 to-teal-600 text-sm font-bold text-white">
        W
      </span>
      <span className="text-sm font-semibold text-gray-900">Workflow Engine</span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, clearAuth } = useAuthStore();
  const { currentWorkspace } = useWorkspaceStore();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const pathname = usePathname();
  const router = useRouter();

  React.useEffect(() => {
    if (!isAuthenticated) {
      const state = useAuthStore.getState();
      if (!state.isAuthenticated) {
        state.initFromStorage();
        if (!useAuthStore.getState().isAuthenticated) {
          router.push('/login');
        }
      }
    }
  }, [isAuthenticated]);

  React.useEffect(() => {
    setReady(true);
  }, []);

  React.useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const handleLogout = async () => {
    try {
      const refreshToken =
        typeof window !== 'undefined' ? localStorage.getItem('refreshToken') : null;
      if (refreshToken) {
        await authService.logout(refreshToken);
      }
    } catch {
      // local session cleanup proceeds regardless of the server response
    } finally {
      clearAuth();
      router.push('/login');
    }
  };

  if (!ready || !isAuthenticated) {
    return <Loading fullScreen message="Loading..." />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-gray-200 bg-white lg:flex">
        <SidebarBrand />
        <SidebarNav pathname={pathname} />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-xl">
            <div className="relative">
              <SidebarBrand />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className="absolute right-2 top-4 rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <SidebarNav pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-h-screen flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-gray-200 bg-white px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden sm:block">
              <WorkspaceSwitcher workspace={currentWorkspace} />
            </div>
            {user?.email && (
              <span className="hidden text-xs font-medium text-gray-500 md:inline">{user.email}</span>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="text-xs font-medium text-gray-600 transition-colors hover:text-rose-600"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

export default AppShell;
