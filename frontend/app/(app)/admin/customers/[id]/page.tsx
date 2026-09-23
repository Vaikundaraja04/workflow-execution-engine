'use client';

import * as React from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { CustomerDetails } from '@/features/admin-customers/components/CustomerDetails';
import { SubscriptionStatus } from '@/features/admin-customers/components/SubscriptionStatus';
import { UsageOverview } from '@/features/admin-customers/components/UsageOverview';
import { useCustomerDetail } from '@/features/admin-customers/useCustomerAdmin';
import { customerApi } from '@/services/customerApi';
import type { ApiClientError } from '@/services/apiClient';
import { hasPermission } from '@/types/permissions';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { Loading } from '@/components/ui/Loading';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';

export default function AdminCustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const workspaceId = params?.id ?? '';
  const { currentRole } = useWorkspaceStore();
  const canAccess = hasPermission(currentRole, 'MEMBER_MANAGE');
  const detail = useCustomerDetail(workspaceId);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const runAction = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      detail.reload();
    } catch (error) {
      setActionError((error as ApiClientError)?.message ?? 'The action failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!canAccess) {
    return (
      <EmptyState
        title="Access restricted"
        description="Customer management is limited to workspace owners and admins. Switch to a workspace where you hold that role."
      />
    );
  }

  if (detail.isLoading) {
    return <Loading message="Loading customer..." />;
  }

  if (detail.error || !detail.data) {
    return (
      <ErrorState
        title="Customer management is restricted"
        message={
          detail.error?.status === 403
            ? 'This account is not on the platform administrator allowlist (PLATFORM_ADMIN_EMAILS).'
            : detail.error?.message
        }
        onRetry={detail.reload}
      />
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/admin/customers"
        className="text-sm font-medium text-emerald-700 hover:text-emerald-800"
      >
        ← All customers
      </Link>

      <CustomerDetails
        detail={detail.data}
        busy={busy}
        actionError={actionError}
        onSuspend={() => runAction(() => customerApi.suspendCustomer(workspaceId))}
        onReactivate={() => runAction(() => customerApi.reactivateCustomer(workspaceId))}
        onAddNote={async (note) => {
          setBusy(true);
          setActionError(null);
          try {
            await customerApi.addCustomerNote(workspaceId, note);
            detail.reload();
            return true;
          } catch (error) {
            setActionError((error as ApiClientError)?.message ?? 'Could not save the note.');
            return false;
          } finally {
            setBusy(false);
          }
        }}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SubscriptionStatus subscription={detail.data.subscription} />
        <UsageOverview usage={detail.data.usage} />
      </div>
    </div>
  );
}
