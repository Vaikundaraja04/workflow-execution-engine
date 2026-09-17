'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { AIPageHeader } from '@/features/ai/components/AIPageHeader';
import { AIUsageDashboard } from '@/features/ai/usage/AIUsageDashboard';

export default function AIUsagePage() {
  const { isAuthenticated } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, router]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <AIPageHeader
        title="AI Usage"
        description="Requests, tokens and estimated cost across AI features"
      />

      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <AIUsageDashboard />
        </div>
      </main>
    </div>
  );
}
