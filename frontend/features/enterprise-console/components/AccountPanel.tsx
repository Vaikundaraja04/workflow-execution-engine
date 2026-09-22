'use client';

import { useCallback } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Loading } from '@/components/ui/Loading';
import { useResource } from '@/hooks/useResource';
import { formatMoney } from '@/features/marketing/components/PackageCatalog';
import { enterpriseOperationsApi } from '@/services/enterpriseOperationsApi';
import type { EnterpriseCustomerStatusDTO } from '@/services/enterpriseOperationsApi';

function statusVariant(status: EnterpriseCustomerStatusDTO): 'success' | 'warning' | 'secondary' | 'destructive' {
  if (status === 'ACTIVE') return 'success';
  if (status === 'TRIAL' || status === 'AT_RISK') return 'warning';
  if (status === 'CHURNED') return 'destructive';
  return 'secondary';
}

export function AccountPanel({ workspaceId }: { workspaceId: string }) {
  const load = useCallback(
    () => (workspaceId ? enterpriseOperationsApi.getAccount(workspaceId) : Promise.resolve(null)),
    [workspaceId],
  );
  const account = useResource(load);

  if (account.isLoading) return <Loading message="Loading the account..." />;
  if (account.error) {
    if (account.error.status === 404) {
      return (
        <EmptyState
          title="No account recorded"
          description="This workspace has no enterprise account yet; the register is created by the account team."
        />
      );
    }
    return (
      <ErrorState
        title="Could not load the account"
        message={account.error.message}
        onRetry={account.reload}
      />
    );
  }
  if (!account.data) {
    return (
      <EmptyState
        title="No workspace selected"
        description="Select a workspace to load its account, usage, health and support."
      />
    );
  }

  const data = account.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Account overview</CardTitle>
        <CardDescription>
          {data.workspaceName ? `${data.company} · ${data.workspaceName}` : data.company}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <p className="text-xs text-gray-500">Customer status</p>
            <Badge variant={statusVariant(data.customerStatus)}>{data.customerStatus}</Badge>
          </div>
          <div>
            <p className="text-xs text-gray-500">Contract</p>
            <p>{data.contractType}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Subscription</p>
            <p>
              {data.subscriptionPlan ?? 'Not linked'}
              {data.subscriptionStatus ? ` · ${data.subscriptionStatus}` : ''}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Renewal</p>
            <p>
              {data.renewalDate
                ? `${data.renewalDate.slice(0, 10)}${data.renewalDueInDays !== null ? ` · in ${data.renewalDueInDays} days` : ''}`
                : 'Not scheduled'}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">MRR</p>
            <p>{data.mrr === null ? 'Not recorded' : formatMoney(data.mrr, 'usd')}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Seats</p>
            <p>{data.seats === null ? 'Not recorded' : data.seats}</p>
          </div>
        </div>
        {data.notes && <p className="text-sm text-gray-700">{data.notes}</p>}
        <p className="text-xs text-gray-400">
          Updated {new Date(data.updatedAt).toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}
