'use client';

import Link from 'next/link';
import { formatBytes } from '@/features/customer-console/components/UsageDashboard';
import type {
  MarketingFreeTier,
  MarketingPlan,
  MarketingPackaging,
  PlanComparisonDTO,
} from '@/services/marketingApi';

/** Package prices are stored in the currency smallest unit (cents / paise). */
export function formatMoney(amount: number, currency: string): string {
  const code = currency.toUpperCase();
  const value = amount / 100;
  if (code === 'INR') {
    return `\u20b9${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  }
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function PackageCards({
  plans,
  freeTier,
  authenticated,
}: {
  plans: MarketingPlan[];
  freeTier: MarketingFreeTier;
  authenticated: boolean;
}) {
  const cards: Array<{
    key: string;
    name: string;
    tagline: string;
    priceMonthly: number;
    currency: string;
    annualPriceMonthly: number | null;
    highlights: string[];
    planQuery: string | null;
  }> = [
    {
      key: 'FREE',
      name: freeTier.name,
      tagline: 'Evaluate the engine with a small workspace',
      priceMonthly: freeTier.priceMonthly,
      currency: freeTier.currency,
      annualPriceMonthly: null,
      highlights: ['3 workflows', '500 executions / month', '3 workspace members'],
      planQuery: null,
    },
    ...plans.map((plan) => ({
      key: plan.id,
      name: plan.name,
      tagline: plan.tagline,
      priceMonthly: plan.priceMonthly,
      currency: plan.currency,
      annualPriceMonthly: plan.annualPriceMonthly,
      highlights: plan.highlights,
      planQuery: plan.id,
    })),
  ];

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.key}
          className="flex flex-col justify-between rounded-xl border border-slate-200 p-5"
        >
          <div>
            <h2 className="text-base font-semibold text-slate-900">{card.name}</h2>
            <p className="mt-1 text-sm text-slate-600">{card.tagline}</p>
            <p className="mt-4 text-2xl font-semibold text-slate-900">
              {formatMoney(card.priceMonthly, card.currency)}
              <span className="text-sm font-normal text-slate-500">/mo</span>
            </p>
            {card.annualPriceMonthly !== null && card.annualPriceMonthly < card.priceMonthly ? (
              <p className="mt-1 text-xs text-slate-500">
                {formatMoney(card.annualPriceMonthly, card.currency)}/mo billed annually
              </p>
            ) : null}
            <ul className="mt-4 space-y-1.5 text-sm text-slate-600">
              {card.highlights.map((highlight) => (
                <li key={highlight}>{highlight}</li>
              ))}
            </ul>
          </div>
          <div className="mt-6 space-y-2">
            <Link
              href={card.planQuery ? `/register?plan=${card.planQuery}` : '/register'}
              className="block rounded-lg bg-emerald-600 px-3 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              {card.planQuery ? `Start with ${card.name}` : 'Start free'}
            </Link>
            {authenticated && card.planQuery ? (
              <Link
                href="/customer/billing"
                className="block rounded-lg border border-slate-300 px-3 py-2 text-center text-sm font-medium text-slate-700 transition-colors hover:bg-white"
              >
                Upgrade in the console
              </Link>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

const MATRIX_ROWS: Array<{
  label: string;
  read: (packaging: MarketingPackaging) => string;
}> = [
  { label: 'Workflows', read: (p) => p.includedWorkflows.toLocaleString() },
  { label: 'Executions / month', read: (p) => p.executionLimit.toLocaleString() },
  { label: 'AI tokens / month', read: (p) => p.aiRequestLimit.toLocaleString() },
  { label: 'AI agents', read: (p) => p.agentLimit.toLocaleString() },
  { label: 'Storage', read: (p) => formatBytes(p.storageBytes) },
  { label: 'Workspace seats', read: (p) => p.seats.toLocaleString() },
  { label: 'Trial days', read: (p) => p.trialDays.toLocaleString() },
  {
    label: 'Support',
    read: (p) =>
      p.supportResponseHours === null
        ? p.supportLevel.toLowerCase()
        : `${p.supportLevel.toLowerCase()} (${p.supportResponseHours}h)`,
  },
];

export function PackageMatrix({ plans }: { plans: MarketingPlan[] }) {
  if (plans.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-900">
              What the package includes
            </th>
            {plans.map((plan) => (
              <th key={plan.id} scope="col" className="px-4 py-3 text-left font-semibold text-slate-900">
                {plan.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {MATRIX_ROWS.map((row) => (
            <tr key={row.label}>
              <th scope="row" className="px-4 py-2.5 text-left font-normal text-slate-600">
                {row.label}
              </th>
              {plans.map((plan) => (
                <td key={plan.id} className="px-4 py-2.5 text-slate-900">
                  {row.read(plan.packaging)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function formatFeature(feature: string): string {
  const words = feature.replace(/_/g, ' ').toLowerCase();
  if (words.startsWith('ai ')) return `AI ${words.slice(3)}`;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function UpgradeDeltas({
  comparisons,
}: {
  comparisons: Array<{ label: string; comparison: PlanComparisonDTO }>;
}) {
  if (comparisons.length === 0) return null;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {comparisons.map(({ label, comparison }) => (
        <div key={label} className="rounded-xl border border-slate-200 p-5">
          <h3 className="text-base font-semibold text-slate-900">{label}</h3>
          <p className="mt-1 text-sm text-slate-600">
            {formatMoney(comparison.to.priceMonthly, comparison.to.currency)}/mo
            {comparison.priceDeltaPercent > 0
              ? ` (${comparison.priceDeltaPercent}% more than ${comparison.from.name})`
              : ''}
          </p>
          {comparison.entitlementsAdded.length > 0 ? (
            <>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Adds
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {comparison.entitlementsAdded.map((feature) => (
                  <li
                    key={feature}
                    className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800"
                  >
                    {formatFeature(feature)}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {comparison.limitDeltas.filter((delta) => (delta.delta ?? 0) > 0).length > 0 ? (
            <>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Higher limits
              </p>
              <ul className="mt-1.5 space-y-1 text-sm text-slate-600">
                {comparison.limitDeltas
                  .filter((delta) => (delta.delta ?? 0) > 0)
                  .map((delta) => (
                    <li key={delta.field}>
                      {formatFeature(delta.field)}: {String(delta.from)} to {String(delta.to)}
                    </li>
                  ))}
              </ul>
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}
