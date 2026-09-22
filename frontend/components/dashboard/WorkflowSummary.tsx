'use client';

import * as React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Workflow as WorkflowIcon } from 'lucide-react';
import type { Workflow } from '@/types/workflow';

export interface WorkflowSummaryProps {
  workflows?: Workflow[];
  totalWorkflows?: number;
  isLoading?: boolean;
}

export const WorkflowSummary: React.FC<WorkflowSummaryProps> = ({
  workflows = [],
  totalWorkflows,
  isLoading = false,
}) => {
  const count = totalWorkflows ?? workflows.length;
  const publishedCount = workflows.filter(
    (w) => w.status === 'PUBLISHED' || (w.publishedVersion ?? 0) > 0 || (w.currentVersion ?? 0) > 0,
  ).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Workflow Summary</CardTitle>
        <WorkflowIcon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-7 w-16 bg-muted rounded"></div>
            <div className="h-4 w-32 bg-muted rounded"></div>
          </div>
        ) : (
          <>
            <div className="text-2xl font-bold">{count}</div>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
              <span>{publishedCount} published</span>
              <span>•</span>
              <span>{count - publishedCount} in draft</span>
            </p>
            <div className="mt-3 flex items-center gap-1.5">
              <Badge variant="outline" size="sm">
                Active Engine
              </Badge>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default WorkflowSummary;
