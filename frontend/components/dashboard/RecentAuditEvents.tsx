'use client';

import * as React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { Shield, Clock } from 'lucide-react';
import type { AuditLog } from '@/types/audit';

export interface RecentAuditEventsProps {
  events?: AuditLog[];
  isLoading?: boolean;
}

export const RecentAuditEvents: React.FC<RecentAuditEventsProps> = ({
  events = [],
  isLoading = false,
}) => {
  const getActionBadge = (action: string) => {
    if (action.includes('CREATED') || action.includes('SUCCESS') || action.includes('REGISTERED')) {
      return <Badge variant="success">{action}</Badge>;
    }
    if (action.includes('FAILED') || action.includes('DELETE') || action.includes('REVOKE')) {
      return <Badge variant="destructive">{action}</Badge>;
    }
    if (action.includes('UPDATED') || action.includes('REPLAY')) {
      return <Badge variant="info">{action}</Badge>;
    }
    return <Badge variant="secondary">{action}</Badge>;
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
            <Shield className="h-4 w-4 text-primary" />
            <CardTitle className="text-base font-semibold">Recent Audit Events</CardTitle>
          </div>
          <CardDescription>Security and administrative activity trail</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground animate-pulse">
            Loading audit events...
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            icon={<Shield className="h-5 w-5" />}
            title="No audit events"
            description="All administrative actions, authentication attempts, and resource mutations will appear here."
            className="border-none py-6"
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.slice(0, 5).map((event) => (
                  <TableRow key={event._id || event.id}>
                    <TableCell>{getActionBadge(event.action)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {event.resource || 'system'}
                      {event.resourceId ? ` (${event.resourceId.substring(0, 6)}...)` : ''}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {event.ipAddress || 'internal'}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDate(event.createdAt)}
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

export default RecentAuditEvents;
