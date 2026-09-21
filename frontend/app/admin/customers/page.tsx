'use client';

import * as React from 'react';
import { useState } from 'react';
import { CustomerTable } from '@/features/admin-customers/components/CustomerTable';
import { useCustomerList } from '@/features/admin-customers/useCustomerAdmin';
import { hasPermission } from '@/types/permissions';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { Loading } from '@/components/ui/Loading';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';

const STATUS_OPTIONS = ['', 'TRIALING', 'ACTIVE', 'SUSPENDED', 'CLOSED'];
const PLAN_OPTIONS = ['', 'FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'];

export default function AdminCustomersPage() {
  const { currentRole } = useWorkspaceStore();
  const canAccess = hasPermission(currentRole, 'MEMBER_MANAGE');
  const [status, setStatus] = useState('');
  const [plan, setPlan] = useState('');
  const [search, setSearch] = useState('');

  const customers = useCustomerList({
    status: status || undefined,
    plan: plan || undefined,
    search: search || undefined,
  });

  if (!canAccess) {
    return (
      <EmptyState
        title="Access restricted"
        description="Customer management is limited to workspace owners and admins. Switch to a workspace where you hold that role."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Customers</h2>
          <p className="mt-1 text-sm text-gray-500">
            Tenants, subscriptions, usage pressure and account health.
          </p>
        </div>
        {customers.data ? (
          <p className="text-sm text-muted-foreground">
            {customers.data.total.toLocaleString()} customer{customers.data.total === 1 ? '' : 's'}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="space-y-1.5 text-sm">
          <span className="font-medium text-foreground">Status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option || 'all'} value={option}>
                {option || 'All statuses'}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5 text-sm">
          <span className="font-medium text-foreground">Plan</span>
          <select
            value={plan}
            onChange={(event) => setPlan(event.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          >
            {PLAN_OPTIONS.map((option) => (
              <option key={option || 'all'} value={option}>
                {option || 'All plans'}
              </option>
            ))}
          </select>
        </label>

        <Input
          label="Search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Company name"
        />
      </div>

      {customers.isLoading ? (
        <Loading message="Loading customers..." />
      ) : customers.error || !customers.data ? (
        <ErrorState
          title="Customer management is restricted"
          message={
            customers.error?.status === 403
              ? 'This account is not on the platform administrator allowlist (PLATFORM_ADMIN_EMAILS).'
              : customers.error?.message
          }
          onRetry={customers.reload}
        />
      ) : (
        <CustomerTable customers={customers.data.customers} />
      )}
    </div>
  );
}
