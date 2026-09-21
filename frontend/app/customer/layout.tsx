'use client';

import * as React from 'react';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { CustomerConsoleHeader } from '@/features/customer-console/components/CustomerConsoleHeader';
import { Loading } from '@/components/ui/Loading';

export default function CustomerConsoleLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
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
      <CustomerConsoleHeader
        title="Customer Console"
        description="Plan, usage and account settings"
      />
      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
