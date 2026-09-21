'use client';

import * as React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import type { AccountDTO, TenantStatusDTO } from '@/types/saas';

const STATUS_VARIANTS: Record<TenantStatusDTO, 'success' | 'info' | 'warning' | 'secondary'> = {
  TRIALING: 'info',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  CLOSED: 'secondary',
};

export function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleDateString() : '—';
}

export function AccountOverview({ account }: { account: AccountDTO }) {
  const { tenant, profile, subscription } = account;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg">{tenant.companyName}</CardTitle>
            <CardDescription>{profile?.contactEmail ?? 'No billing contact on file'}</CardDescription>
          </div>
          <Badge variant={STATUS_VARIANTS[tenant.status]}>{tenant.status}</Badge>
        </div>
      </CardHeader>      <CardContent className="space-y-5">
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Current plan</dt>
            <dd className="font-medium text-foreground">{subscription?.plan ?? tenant.plan}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Region</dt>
            <dd className="font-medium text-foreground">{tenant.region}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Trial ends</dt>
            <dd className="font-medium text-foreground">
              {formatDate(tenant.trialEndsAt ?? subscription?.trialEndsAt ?? null)}
            </dd>
          </div>
        </dl>

        <div>
          <h3 className="text-sm font-medium text-foreground">Onboarding</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {tenant.onboarding.completed
              ? `Completed ${formatDate(tenant.onboarding.completedAt)}`
              : 'In progress'}
          </p>
          {tenant.onboarding.steps.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {tenant.onboarding.steps.map((step) => (
                <li key={step} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No onboarding steps recorded yet.</p>
          )}
        </div>

        {tenant.demo ? (
          <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            This workspace is a demo sandbox. It is deleted automatically once the sandbox expires.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default AccountOverview;