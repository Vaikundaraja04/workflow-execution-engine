'use client';

import * as React from 'react';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Loading } from '@/components/ui/Loading';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { InvoiceHistory } from '@/features/customer-console/components/InvoiceHistory';
import {
  useAccount,
  useEntitlements,
  useInvoices,
  usePayments,
  usePlans,
} from '@/features/customer-console/useCustomerData';
import { formatMoney } from '@/features/marketing/components/PackageCatalog';
import { billingConsoleApi } from '@/services/billingConsoleApi';
import type { CheckoutVerificationDTO } from '@/services/billingConsoleApi';
import type { ApiClientError } from '@/services/apiClient';
import { hasPermission } from '@/types/permissions';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { CatalogPlanDTO, PlanIdDTO } from '@/types/saas';

/** Checkout takes sellable package ids; the console catalog uses internal plans. */
const PACKAGE_BY_PLAN: Record<PlanIdDTO, string | null> = {
  FREE: null,
  STARTER: 'STARTER',
  PROFESSIONAL: 'BUSINESS',
  ENTERPRISE: 'ENTERPRISE',
};

const SUBSCRIPTION_VARIANTS = {
  ACTIVE: 'success',
  TRIALING: 'info',
  PAST_DUE: 'warning',
  CANCELLED: 'secondary',
  EXPIRED: 'destructive',
} as const;

export default function CustomerBillingPage() {
  const account = useAccount();
  const plans = usePlans();
  const invoices = useInvoices();
  const payments = usePayments();
  const entitlements = useEntitlements();
  const { currentRole } = useWorkspaceStore();
  const canManage = hasPermission(currentRole, 'WORKFLOW_CREATE');
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [checkoutResult, setCheckoutResult] = useState<CheckoutVerificationDTO | null>(null);

  const startCheckout = async (plan: CatalogPlanDTO) => {
    const packageId = PACKAGE_BY_PLAN[plan.id];
    if (!packageId) return;
    setBusyPlan(plan.id);
    setActionError(null);
    setCheckoutResult(null);
    try {
      const session = await billingConsoleApi.createCheckoutSession({ packageId });
      const result = await billingConsoleApi.verifyCheckout({
        paymentId: session.id,
        packageId,
      });
      setCheckoutResult(result);
      account.reload();
      entitlements.reload();
      payments.reload();
      invoices.reload();
    } catch (error) {
      setActionError((error as ApiClientError)?.message ?? 'The checkout could not be completed.');
    } finally {
      setBusyPlan(null);
    }
  };

  if (account.isLoading) {
    return <Loading message="Loading billing..." />;
  }

  if (account.error || !account.data) {
    return (
      <ErrorState
        title="Could not load billing"
        message={account.error?.message}
        onRetry={account.reload}
      />
    );
  }

  const { tenant, subscription, usage } = account.data;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Billing console</h2>
        <p className="mt-1 text-sm text-gray-500">
          Plan, usage against limits, payments and invoices for {tenant.companyName}.
        </p>
      </div>

      {actionError ? (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {actionError}
        </p>
      ) : null}

      {checkoutResult ? (
        <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          {checkoutResult.activated
            ? `Payment ${checkoutResult.payment.id} settled — the workspace is now on ${checkoutResult.subscription?.plan ?? 'the selected plan'}.`
            : checkoutResult.alreadyActive
              ? 'This workspace is already on that package.'
              : `Payment ${checkoutResult.payment.id} is ${checkoutResult.payment.status}; the subscription was left untouched.`}
        </p>
      ) : null}

      {!canManage ? (
        <p className="rounded-lg bg-gray-100 p-3 text-xs text-gray-600">
          You have read-only access to billing. Ask a workspace owner or admin to change the plan.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-lg">Current subscription</CardTitle>
              <CardDescription>Plan, billing provider and current period</CardDescription>
            </div>
            {subscription ? (
              <Badge variant={SUBSCRIPTION_VARIANTS[subscription.status]}>
                {subscription.status}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-gray-700">
          {subscription ? (
            <>
              <p>
                {subscription.plan} plan via {subscription.billingProvider}
              </p>
              <p className="text-xs text-gray-500">
                Period {new Date(subscription.currentPeriodStart).toLocaleDateString()} –{' '}
                {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                {subscription.trialEndsAt
                  ? ` · trial ends ${new Date(subscription.trialEndsAt).toLocaleDateString()}`
                  : ''}
              </p>
            </>
          ) : (
            <p>No subscription recorded yet. Choose a package below to start one.</p>
          )}
          {entitlements.data ? (
            <p className="text-xs text-gray-500">
              {entitlements.data.packageName
                ? `${entitlements.data.packageName} package · ${entitlements.data.features.filter((feature) => feature.entitled).length} of ${entitlements.data.features.length} features entitled`
                : `Plan ${entitlements.data.plan ?? 'none'} · entitlements evaluated live from the subscription`}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Usage against your limits</CardTitle>
          <CardDescription>
            Metered usage for {usage.periodKey}, with the plan limit from your package
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {usage.metrics.map((metric) => (
            <div key={metric.metric}>
              <div className="flex items-center justify-between text-xs text-gray-600">
                <span>{metric.metric.replace(/_/g, ' ').toLowerCase()}</span>
                <span>
                  {metric.value.toLocaleString()} / {metric.limit?.toLocaleString() ?? 'unlimited'}
                  {metric.overage ? ' · overage' : ''}
                </span>
              </div>
              <div
                role="meter"
                aria-label={`${metric.metric.replace(/_/g, ' ').toLowerCase()} usage`}
                aria-valuenow={metric.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100"
              >
                <div
                  className={metric.alertState === 'EXCEEDED' ? 'h-full bg-red-500' : 'h-full bg-emerald-500'}
                  style={{ width: `${Math.min(100, metric.percent)}%` }}
                />
              </div>
            </div>
          ))}
          {entitlements.data && entitlements.data.quotas.some((quota) => quota.exceeded) ? (
            <p className="text-xs text-red-600">
              Exceeded:{' '}
              {entitlements.data.quotas
                .filter((quota) => quota.exceeded)
                .map((quota) => quota.feature.replace(/_/g, ' ').toLowerCase())
                .join(', ')}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-gray-900">Packages</h3>
        {plans.isLoading ? (
          <Loading message="Loading plan catalog..." />
        ) : plans.error || !plans.data ? (
          <ErrorState
            title="Could not load the plan catalog"
            message={plans.error?.message}
            onRetry={plans.reload}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {plans.data.plans.map((plan) => {
              const isCurrent = plan.id === tenant.plan;
              const purchasable = PACKAGE_BY_PLAN[plan.id] !== null;
              return (
                <Card
                  key={plan.id}
                  className={
                    isCurrent
                      ? 'flex flex-col border-emerald-500 ring-1 ring-emerald-500'
                      : 'flex flex-col'
                  }
                >
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base">{plan.name}</CardTitle>
                      {isCurrent ? <Badge variant="success">Current</Badge> : null}
                    </div>
                    <CardDescription>{plan.description}</CardDescription>
                    <p className="pt-2 text-2xl font-semibold text-gray-900">
                      {formatMoney(plan.priceMonthly, plan.currency)}
                      <span className="text-sm font-normal text-gray-500">/mo</span>
                    </p>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col justify-between gap-3">
                    <ul className="space-y-1 text-xs text-gray-600">
                      <li>{plan.limits.workflows.toLocaleString()} workflows</li>
                      <li>{plan.limits.executionsPerMonth.toLocaleString()} executions / month</li>
                      <li>{plan.limits.members.toLocaleString()} members</li>
                    </ul>
                    <Button
                      size="sm"
                      variant={isCurrent ? 'outline' : 'default'}
                      disabled={isCurrent || !canManage || busyPlan !== null || !purchasable}
                      onClick={() => startCheckout(plan)}
                    >
                      {isCurrent
                        ? 'Current plan'
                        : purchasable
                          ? busyPlan === plan.id
                            ? 'Opening checkout...'
                            : `Checkout ${plan.name}`
                          : 'Free tier'}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Entitlements</CardTitle>
          <CardDescription>
            Features your subscription unlocks — derived from the plan, never stored separately
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entitlements.isLoading ? (
            <Loading message="Evaluating entitlements..." />
          ) : entitlements.error || !entitlements.data ? (
            <ErrorState
              title="Could not evaluate entitlements"
              message={entitlements.error?.message}
              onRetry={entitlements.reload}
            />
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {entitlements.data.features.map((feature) => (
                <li
                  key={feature.feature}
                  className={
                    feature.entitled
                      ? 'rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800'
                      : 'rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500'
                  }
                >
                  {feature.feature.replace(/_/g, ' ').toLowerCase()}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-gray-900">Payment history</h3>
        {payments.isLoading ? (
          <Loading message="Loading payments..." />
        ) : payments.error || !payments.data ? (
          <ErrorState
            title="Could not load payments"
            message={payments.error?.message}
            onRetry={payments.reload}
          />
        ) : payments.data.length === 0 ? (
          <EmptyState
            title="No payments yet"
            description="Verified checkout payments appear here as soon as they settle."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="min-w-full divide-y text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left font-medium text-gray-500">Payment</th>
                  <th scope="col" className="px-4 py-2 text-left font-medium text-gray-500">Provider</th>
                  <th scope="col" className="px-4 py-2 text-left font-medium text-gray-500">Method</th>
                  <th scope="col" className="px-4 py-2 text-left font-medium text-gray-500">Amount</th>
                  <th scope="col" className="px-4 py-2 text-left font-medium text-gray-500">Status</th>
                  <th scope="col" className="px-4 py-2 text-left font-medium text-gray-500">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y text-gray-700">
                {payments.data.map((payment) => (
                  <tr key={payment._id}>
                    <td className="px-4 py-2 font-mono text-xs">{payment.paymentId}</td>
                    <td className="px-4 py-2">{payment.provider}</td>
                    <td className="px-4 py-2">{payment.method ?? '—'}</td>
                    <td className="px-4 py-2">{formatMoney(payment.amount, payment.currency)}</td>
                    <td className="px-4 py-2">{payment.status}</td>
                    <td className="px-4 py-2">{new Date(payment.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
