'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import type { SubscriptionDTO } from '@/types/saas';

const STATUS_VARIANTS: Record<
  SubscriptionDTO['status'],
  'success' | 'info' | 'warning' | 'secondary' | 'destructive'
> = {
  ACTIVE: 'success',
  TRIALING: 'info',
  PAST_DUE: 'warning',
  CANCELLED: 'secondary',
  EXPIRED: 'destructive',
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : '—';
}

export function SubscriptionStatus({ subscription }: { subscription: SubscriptionDTO | null }) {
  if (!subscription) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Subscription</CardTitle>
          <CardDescription>No subscription is recorded for this workspace.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg">Subscription</CardTitle>
            <CardDescription>
              {subscription.plan} via {subscription.billingProvider}
            </CardDescription>
          </div>
          <Badge variant={STATUS_VARIANTS[subscription.status]}>{subscription.status}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Current period start</dt>
            <dd className="font-medium text-foreground">{formatDate(subscription.currentPeriodStart)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Current period end</dt>
            <dd className="font-medium text-foreground">{formatDate(subscription.currentPeriodEnd)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Trial ends</dt>
            <dd className="font-medium text-foreground">{formatDate(subscription.trialEndsAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Subscription ID</dt>
            <dd className="font-mono text-xs text-foreground">{subscription.id}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

export default SubscriptionStatus;
