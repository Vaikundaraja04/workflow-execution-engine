'use client';

import * as React from 'react';
import { SecuritySettings } from '@/features/customer-console/components/SecuritySettings';
import { useAccount } from '@/features/customer-console/useCustomerData';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { Loading } from '@/components/ui/Loading';
import { ErrorState } from '@/components/ui/ErrorState';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';

export default function CustomerSettingsPage() {
  const account = useAccount();
  const { currentWorkspace, currentRole } = useWorkspaceStore();

  if (account.isLoading) {
    return <Loading message="Loading settings..." />;
  }

  if (account.error || !account.data) {
    return (
      <ErrorState
        title="Could not load your settings"
        message={account.error?.message}
        onRetry={account.reload}
      />
    );
  }

  const { tenant, profile } = account.data;

  const billingAddress = profile?.billingAddress
    ? [profile.billingAddress.line1, profile.billingAddress.city, profile.billingAddress.country]
        .filter(Boolean)
        .join(', ')
    : '';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
        <p className="mt-1 text-sm text-gray-500">
          Profile, workspace and security preferences for this account.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Profile</CardTitle>
            <CardDescription>Billing contact recorded for this tenant.</CardDescription>
          </CardHeader>
          <CardContent>
            {profile ? (
              <dl className="grid grid-cols-1 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Contact name</dt>
                  <dd className="font-medium text-foreground">{profile.contactName}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Contact email</dt>
                  <dd className="font-medium text-foreground">{profile.contactEmail}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd className="font-medium text-foreground">{profile.contactPhone ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Company</dt>
                  <dd className="font-medium text-foreground">{profile.company}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Tax ID</dt>
                  <dd className="font-medium text-foreground">{profile.taxId ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Timezone / locale</dt>
                  <dd className="font-medium text-foreground">
                    {profile.timezone} · {profile.locale}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Billing address</dt>
                  <dd className="font-medium text-foreground">{billingAddress || '—'}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                No billing contact has been recorded for this tenant yet.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Workspace</CardTitle>
            <CardDescription>Workspace, tenant and region identifiers.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Workspace</dt>
                <dd className="font-medium text-foreground">
                  {currentWorkspace?.name ?? tenant.companyName}
                  {currentWorkspace?.slug ? ` (${currentWorkspace.slug})` : ''}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Your role</dt>
                <dd className="font-medium text-foreground">{currentRole ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Tenant</dt>
                <dd className="font-medium text-foreground">
                  {tenant.companyName} · {tenant.status}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Plan</dt>
                <dd className="font-medium text-foreground">{tenant.plan}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Region</dt>
                <dd className="font-medium text-foreground">{tenant.region}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Workspace ID</dt>
                <dd className="font-mono text-xs text-foreground">{tenant.workspaceId}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <SecuritySettings />
    </div>
  );
}
