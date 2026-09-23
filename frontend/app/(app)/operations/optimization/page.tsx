'use client';

import * as React from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { OptimizationDashboard } from '@/features/optimization/OptimizationDashboard';

export default function OptimizationPage() {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id || '';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <OptimizationDashboard workspaceId={workspaceId} />
    </div>
  );
}