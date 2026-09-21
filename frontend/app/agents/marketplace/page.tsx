'use client';

import * as React from 'react';
import { AgentMarketplaceDashboard } from '@/features/agents/marketplace/AgentMarketplaceDashboard';

export default function AgentMarketplacePage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AgentMarketplaceDashboard />
    </div>
  );
}