'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { formatBytes } from '@/features/customer-console/components/UsageDashboard';
import type { CustomerRowDTO, TenantStatusDTO } from '@/types/saas';

const STATUS_VARIANTS: Record<TenantStatusDTO, 'success' | 'info' | 'warning' | 'secondary'> = {
  TRIALING: 'info',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  CLOSED: 'secondary',
};

const HEALTH_VARIANTS = {
  healthy: 'success',
  watch: 'warning',
  at_risk: 'destructive',
} as const;

export function CustomerTable({ customers }: { customers: CustomerRowDTO[] }) {
  if (customers.length === 0) {
    return (
      <EmptyState
        title="No customers found"
        description="No tenant matches the current filters."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Customer</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Plan</TableHead>
          <TableHead>Subscription</TableHead>
          <TableHead>Usage</TableHead>
          <TableHead>Health</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {customers.map((customer) => (
          <TableRow key={customer.tenantId}>
            <TableCell>
              <div className="flex items-center gap-2">
                <Link
                  href={`/admin/customers/${customer.workspaceId}`}
                  className="font-medium text-emerald-700 hover:text-emerald-800"
                >
                  {customer.companyName}
                </Link>
                {customer.demo ? <Badge variant="warning">Demo</Badge> : null}
              </div>
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                {customer.region}
              </p>
            </TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANTS[customer.status]}>{customer.status}</Badge>
              {customer.workspaceStatus && customer.workspaceStatus !== 'ACTIVE' ? (
                <p className="mt-1 text-[11px] text-amber-600">
                  Workspace {customer.workspaceStatus.toLowerCase()}
                </p>
              ) : null}
            </TableCell>
            <TableCell>{customer.plan}</TableCell>
            <TableCell>
              {customer.subscription ? (
                <>
                  <span className="font-medium text-foreground">
                    {customer.subscription.status}
                  </span>
                  <p className="text-[11px] text-muted-foreground">
                    {customer.subscription.billingProvider} · renews{' '}
                    {new Date(customer.subscription.currentPeriodEnd).toLocaleDateString()}
                  </p>
                </>
              ) : (
                <span className="text-muted-foreground">No subscription</span>
              )}
            </TableCell>
            <TableCell>
              <div className="text-sm">
                {customer.usage.executionsThisMonth.toLocaleString()} executions
              </div>
              <p className="text-[11px] text-muted-foreground">
                {formatBytes(customer.usage.storageBytes)} storage
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {customer.usage.exceededMetrics.map((metric) => (
                  <Badge key={metric} variant="destructive" size="sm">
                    {metric} over
                  </Badge>
                ))}
                {customer.usage.warningMetrics.map((metric) => (
                  <Badge key={metric} variant="warning" size="sm">
                    {metric} high
                  </Badge>
                ))}
              </div>
            </TableCell>
            <TableCell>
              <Badge variant={HEALTH_VARIANTS[customer.health.band]}>
                {customer.health.band} · {customer.health.score}
              </Badge>
            </TableCell>
            <TableCell>{new Date(customer.createdAt).toLocaleDateString()}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default CustomerTable;
