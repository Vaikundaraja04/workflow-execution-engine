'use client';

import * as React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { Activity, Clock, PlayCircle } from 'lucide-react';
import Link from 'next/link';
import type { WorkflowExecution, ExecutionStatus } from '@/types/execution';

export interface RecentExecutionsProps {
  executions?: WorkflowExecution[];
  isLoading?: boolean;
}

export const RecentExecutions: React.FC<RecentExecutionsProps> = ({
  executions = [],
  isLoading = false,
}) => {
  const getStatusBadge = (status: ExecutionStatus) => {
    switch (status) {
      case 'COMPLETED':
        return <Badge variant="success">Completed</Badge>;
      case 'RUNNING':
        return <Badge variant="info">Running</Badge>;
      case 'FAILED':
        return <Badge variant="destructive">Failed</Badge>;
      case 'CANCELLED':
        return <Badge variant="secondary">Cancelled</Badge>;
      case 'RETRYING':
        return <Badge variant="warning">Retrying</Badge>;
      default:
        return <Badge variant="outline">Pending</Badge>;
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <Activity className="h-4 w-4 text-primary" />
            <CardTitle className="text-base font-semibold">Recent Executions</CardTitle>
          </div>
          <CardDescription>Latest workflow execution runs in this workspace</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground animate-pulse">
            Loading recent executions...
          </div>
        ) : executions.length === 0 ? (
          <EmptyState
            icon={<PlayCircle className="h-5 w-5" />}
            title="No executions yet"
            description="Trigger or schedule a workflow to see its execution logs and performance metrics here."
            className="border-none py-6"
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Execution ID</TableHead>
                  <TableHead>Workflow ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead className="text-right">Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {executions.slice(0, 5).map((exec) => (
                  <TableRow key={exec._id || exec.id}>
                    <TableCell className="font-mono text-xs text-foreground">
                      <Link href={'/executions/' + (exec._id || exec.id || '')} className="text-emerald-700 transition-colors hover:text-emerald-800 hover:underline">{(exec._id || exec.id || '').substring(0, 8)}...</Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {(exec.workflowId || '').substring(0, 8)}...
                    </TableCell>
                    <TableCell>{getStatusBadge(exec.status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      v{exec.version || 1}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDate(exec.startedAt || exec.createdAt)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default RecentExecutions;
