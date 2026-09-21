'use client';

import * as React from 'react';
import { useState } from 'react';
import { InvoiceHistory } from '@/features/customer-console/components/InvoiceHistory';
import { PlanComparison } from '@/features/customer-console/components/PlanComparison';
import { SubscriptionCard } from '@/features/customer-console/components/SubscriptionCard';
import { useAccount, useInvoices, usePlans } from '@/features/customer-console/useCustomerData';
import { customerApi } from '@/services/customerApi';
import type { ApiClientError } from '@/services/apiClient';
import { hasPermission } from '@/types/permissions';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { PlanIdDTO } from '@/types/saas';
import { Loading } from '@/components/ui/Loading';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';

const TRIAL_DAYS = 14;

export default function CustomerSubscriptionPage() {
  const account = useAccount();
  const plans = usePlans();
  const invoices = useInvoices();
  const { currentRole } = useWorkspaceStore();
  const canManage = hasPermission(currentRole, 'WORKFLOW_CREATE');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const runAction = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      account.reload();
      invoices.reload();
    } catch (error) {
      setActionError((error as ApiClientError)?.message ?? 'The billing action failed.');
    } finally {
      setBusy(false);
    }
  };

  if (account.isLoading) {
    return <Loading message="Loading subscription..." />;
  }

  if (account.error || !account.data) {
    return (
      <ErrorState
        title="Could not load your subscription"
        message={account.error?.message}
        onRetry={account.reload}
      />
    );
  }

  const { subscription } = account.data;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Subscription</h2>
        <p className="mt-1 text-sm text-gray-500">
          Current plan, billing cycle and plan limits for this workspace.
        </p>
      </div>

      {actionError ? (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {actionError}
        </p>
      ) : null}

      {subscription ? (
        <SubscriptionCard
          subscription={subscription}
          canManage={canManage}
          busy={busy}
          onChangePlan={(plan: PlanIdDTO) => runAction(() => customerApi.changePlan(plan))}
          onStartTrial={() => runAction(() => customerApi.startTrial(TRIAL_DAYS))}
          onCancel={() => runAction(() => customerApi.cancelSubscription(false))}
        />
      ) : (
        <EmptyState
          title="No subscription yet"
          description="This workspace does not have a subscription record. Start a trial or choose a plan to create one."
        />
      )}

      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-gray-900">Available plans</h3>
        {plans.isLoading ? (
          <Loading message="Loading plan catalog..." />
        ) : plans.error || !plans.data ? (
          <ErrorState
            title="Could not load the plan catalog"
            message={plans.error?.message}
            onRetry={plans.reload}
          />
        ) : (
          <PlanComparison
            plans={plans.data.plans}
            currentPlan={account.data.tenant.plan}
            canManage={canManage}
            busy={busy}
            onChangePlan={(plan: PlanIdDTO) => runAction(() => customerApi.changePlan(plan))}
          />
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-gray-900">Invoices</h3>
        {invoices.isLoading ? (
          <Loading message="Loading invoices..." />
        ) : invoices.error || !invoices.data ? (
          <ErrorState
            title="Could not load invoices"
            message={invoices.error?.message}
            onRetry={invoices.reload}
          />
        ) : (
          <InvoiceHistory invoices={invoices.data} />
        )}
      </section>
    </div>
  );
}
