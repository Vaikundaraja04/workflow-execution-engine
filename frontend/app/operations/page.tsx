'use client';

import React from 'react';
import Link from 'next/link';
import { useOperationsStore } from '@/stores/operationsStore';
import { ExecutiveOverview } from '@/features/enterprise-operations/ExecutiveOverview';
import { SystemHealth } from '@/features/enterprise-operations/SystemHealth';
import { useEffect } from 'react';

export default function OperationsPage() {
  const { fetchOverviewAnalytics, fetchSystemHealth, fetchSystemMetrics } = useOperationsStore();

  useEffect(() => {
    // In a real app, we would get the workspaceId from context or URL
    // For now, we'll use a placeholder or get it from auth context
    const workspaceId = 'workspace-1'; // This should come from auth context

    fetchOverviewAnalytics(workspaceId);
    fetchSystemHealth();
    fetchSystemMetrics();

    // Cleanup function would go here if needed
    return () => {
      // cleanup if needed
    };
  }, [fetchOverviewAnalytics, fetchSystemHealth, fetchSystemMetrics]);

  return (
    <div className="space-y-8">
      <nav className="flex flex-wrap gap-2">
        <Link href="/operations/analytics" className="px-3 py-1 rounded bg-muted hover:bg-muted/80">
          Analytics
        </Link>
        <Link href="/operations/reports" className="px-3 py-1 rounded bg-muted hover:bg-muted/80">
          Reports
        </Link>
        <Link href="/operations/security" className="px-3 py-1 rounded bg-muted hover:bg-muted/80">
          Security
        </Link>
        <Link href="/operations/autonomous" className="px-3 py-1 rounded bg-muted hover:bg-muted/80">
          Autonomous Operations
        </Link>
      </nav>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Executive Overview - takes full width */}
        <div className="col-span-12 lg:col-span-8">
          <ExecutiveOverview />
        </div>

        {/* System Health - takes remaining space */}
        <div className="col-span-12 lg:col-span-4">
          <SystemHealth />
        </div>
      </div>
    </div>
  );
}