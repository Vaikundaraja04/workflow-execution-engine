'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { AIPageHeader } from '@/features/ai/components/AIPageHeader';
import { TemplateGenerator } from '@/features/ai/template-generation/TemplateGenerator';

export default function AITemplateGeneratorPage() {
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
        title="AI Template Generator"
        description="Generate marketplace-ready templates with suggested metadata"
      />

      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <TemplateGenerator />
        </div>
      </main>
    </div>
  );
}
