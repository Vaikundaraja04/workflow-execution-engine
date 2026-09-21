'use client';

import type { PlanIdDTO, SubscriptionDTO } from '@/types/saas';

const STATUS_CLASSES: Record<SubscriptionDTO['status'], string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  TRIALING: 'bg-blue-100 text-blue-800',
  PAST_DUE: 'bg-yellow-100 text-yellow-800',
  CANCELLED: 'bg-gray-200 text-gray-700',
  EXPIRED: 'bg-red-100 text-red-800',
};

const PLANS: PlanIdDTO[] = ['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'];
const PLAN_PRICES: Record<PlanIdDTO, string> = {
  FREE: '$0',
  STARTER: '$29',
  PROFESSIONAL: '$99',
  ENTERPRISE: '$499',
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString();
}

export function SubscriptionCard({
  subscription,
  canManage,
  busy,
  onChangePlan,
  onStartTrial,
  onCancel,
}: {
  subscription: SubscriptionDTO;
  canManage: boolean;
  busy: boolean;
  onChangePlan: (plan: PlanIdDTO) => void;
  onStartTrial: () => void;
  onCancel: () => void;
}) {
  return (
    <section
      aria-label="Subscription"
      className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
    >
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{subscription.plan} plan</h2>
          <p className="text-sm text-gray-500">
            Billing provider: {subscription.billingProvider}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_CLASSES[subscription.status]}`}
        >
          {subscription.status}
        </span>
      </header>
      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-gray-500">Current period</dt>
          <dd className="font-medium text-gray-900">
            {formatDate(subscription.currentPeriodStart)} → {formatDate(subscription.currentPeriodEnd)}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Trial ends</dt>
          <dd className="font-medium text-gray-900">{formatDate(subscription.trialEndsAt)}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Monthly price</dt>
          <dd className="font-medium text-gray-900">{PLAN_PRICES[subscription.plan]}</dd>
        </div>
      </dl>

      {!canManage ? (
        <p className="mt-4 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          You have read-only access to billing. Ask a workspace owner or admin to change the plan.
        </p>
      ) : null}

      <div className="mt-5">
        <h3 className="text-sm font-medium text-gray-700">Change plan</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {PLANS.map((plan) => (
            <button
              key={plan}
              type="button"
              disabled={!canManage || busy || plan === subscription.plan}
              onClick={() => onChangePlan(plan)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {plan} - {PLAN_PRICES[plan]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canManage || busy}
          onClick={onStartTrial}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Start free trial
        </button>
        <button
          type="button"
          disabled={!canManage || busy || subscription.status === 'EXPIRED'}
          onClick={onCancel}
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel subscription
        </button>
      </div>
    </section>
  );
}

export default SubscriptionCard;
