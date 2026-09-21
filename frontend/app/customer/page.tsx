'use client';

import * as React from 'react';
import Link from 'next/link';
import { AccountOverview } from '@/features/customer-console/components/AccountOverview';
import { UsageDashboard } from '@/features/customer-console/components/UsageDashboard';
import { useAccount } from '@/features/customer-console/useCustomerData';
import { Loading } from '@/components/ui/Loading';
import { ErrorState } from '@/components/ui/ErrorState';
import { Badge } from '@/components/ui/Badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';

const SUBSCRIPTION_VARIANTS = {
  ACTIVE: 'success',
  TRIALING: 'info',
  PAST_DUE: 'warning',
  CANCELLED: 'secondary',
  EXPIRED: 'destructive',
} as const;

export default function CustomerOverviewPage() {
  const account = useAccount();

  if (account.isLoading) {
    return <Loading message="Loading your account..." />;
  }

  if (account.error || !account.data) {
    return (
      <ErrorState
        title="Could not load your account"
        message={account.error?.message}
        onRetry={account.reload}
      />
    );
  }

  const { tenant, subscription, usage } = account.data;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Account overview</h2>
        <p className="mt-1 text-sm text-gray-500">
          Company, plan and workspace status for {tenant.companyName}.
        </p>
      </div>

      <AccountOverview account={account.data} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-lg">Subscription</CardTitle>
                <CardDescription>Current plan and billing cycle</CardDescription>
              </div>
              {subscription ? (
                <Badge variant={SUBSCRIPTION_VARIANTS[subscription.status]}>
                  {subscription.status}
                </Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-foreground">
              {subscription
                ? `${subscription.plan} plan via ${subscription.billingProvider}`
                : 'No subscription recorded for this workspace yet.'}
            </p>
            <Link
              href="/customer/subscription"
              className="font-medium text-emerald-700 hover:text-emerald-800"
            >
              Manage subscription
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Usage this period</CardTitle>
            <CardDescription>
              {usage.periodKey} · plan {usage.plan ?? 'none'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/customer/usage"
              className="text-sm font-medium text-emerald-700 hover:text-emerald-800"
            >
              View detailed usage
            </Link>
          </CardContent>
        </Card>
      </div>

      <UsageDashboard summary={usage} />
    </div>
  );
}
