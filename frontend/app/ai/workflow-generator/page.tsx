'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { AIPageHeader } from '@/features/ai/components/AIPageHeader';
import { WorkflowGenerator } from '@/features/ai/workflow-generation/WorkflowGenerator';

export default function AIWorkflowGeneratorPage() {
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
        title="AI Workflow Generator"
        description="Turn natural language prompts into validated workflow drafts"
      />

      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <WorkflowGenerator />
        </div>
      </main>
    </div>
  );
}
