'use client';

import * as React from 'react';
import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Users } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { Loading } from '@/components/ui/Loading';

export default function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  const { currentWorkspace } = useWorkspaceStore();
  const router = useRouter();

  useEffect(() => {
    if (!useAuthStore.getState().isAuthenticated) {
      useAuthStore.getState().initFromStorage();
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, router]);

  if (!isAuthenticated) {
    return <Loading fullScreen message="Redirecting to sign in..." />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-3">
              <Link
                href="/dashboard"
                className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                title="Back to dashboard"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 text-white">
                <Users className="h-4 w-4" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-gray-900">Customer Management</h1>
                <p className="text-[11px] text-gray-500">Platform operator console</p>
              </div>
            </div>

            <WorkspaceSwitcher workspace={currentWorkspace} />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
