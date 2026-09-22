'use client';

import { useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Loading } from '@/components/ui/Loading';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { useResource } from '@/hooks/useResource';
import { enterpriseOperationsApi } from '@/services/enterpriseOperationsApi';

export function SupportPanel({ workspaceId }: { workspaceId: string }) {
  const load = useCallback(
    () => (workspaceId ? enterpriseOperationsApi.listTickets({ workspaceId, limit: 10 }) : Promise.resolve(null)),
    [workspaceId],
  );
  const tickets = useResource(load);

  if (tickets.isLoading) return <Loading message="Loading support tickets..." />;
  if (tickets.error) {
    return (
      <ErrorState
        title="Could not load support tickets"
        message={tickets.error.message}
        onRetry={tickets.reload}
      />
    );
  }
  if (!tickets.data) {
    return (
      <EmptyState
        title="No workspace selected"
        description="Select a workspace to load its support desk."
      />
    );
  }

  const data = tickets.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Support</CardTitle>
        <CardDescription>
          The ticket desk for this workspace with the SLA state stamped at creation
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-gray-500">Total</p>
            <p className="text-2xl font-semibold text-gray-900">{data.summary.total}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Open</p>
            <p className="text-2xl font-semibold text-gray-900">{data.summary.open}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Breached</p>
            <p className="text-2xl font-semibold text-gray-900">{data.summary.breached}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Resolved</p>
            <p className="text-2xl font-semibold text-gray-900">{data.summary.resolved}</p>
          </div>
        </div>
        {data.items.length === 0 ? (
          <p className="text-sm text-gray-500">No tickets recorded for this workspace.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>SLA</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((ticket) => (
                <TableRow key={ticket.ticketId}>
                  <TableCell>{ticket.ticketNumber}</TableCell>
                  <TableCell>{ticket.subject}</TableCell>
                  <TableCell>{ticket.priority}</TableCell>
                  <TableCell>{ticket.status}</TableCell>
                  <TableCell>{ticket.breached ? 'Breached' : ticket.overdue ? 'Overdue' : 'On track'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-gray-400">
          Generated {new Date(data.generatedAt).toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}
