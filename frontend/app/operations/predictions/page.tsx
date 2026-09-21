'use client';

import * as React from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { PredictionDashboard } from '@/features/predictive-intelligence/PredictionDashboard';

export default function PredictionsPage() {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id || '';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <PredictionDashboard workspaceId={workspaceId} />
    </div>
  );
}