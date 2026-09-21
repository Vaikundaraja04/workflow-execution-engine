'use client';

import * as React from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import type { CatalogPlanDTO, PlanIdDTO } from '@/types/saas';

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function PlanComparison({
  plans,
  currentPlan,
  canManage,
  busy,
  onChangePlan,
}: {
  plans: CatalogPlanDTO[];
  currentPlan: PlanIdDTO | null;
  canManage: boolean;
  busy: boolean;
  onChangePlan: (plan: PlanIdDTO) => void;
}) {
  return (
    <section aria-label="Plan comparison" className="space-y-4">
      {!canManage ? (
        <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          You have read-only access to billing. Ask a workspace owner or admin to change the plan.
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const isCurrent = plan.id === currentPlan;
          return (
            <Card
              key={plan.id}
              className={cn('flex flex-col', isCurrent && 'border-emerald-500 ring-1 ring-emerald-500')}
            >              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{plan.name}</CardTitle>
                  {isCurrent ? <Badge variant="success">Current</Badge> : null}
                </div>
                <CardDescription>{plan.description}</CardDescription>
                <p className="pt-2 text-2xl font-semibold text-foreground">
                  {formatPrice(plan.priceMonthly)}
                  <span className="text-sm font-normal text-muted-foreground">/mo</span>
                </p>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-4">
                <ul className="space-y-1.5 text-xs text-muted-foreground">
                  <li>{plan.limits.workflows.toLocaleString()} workflows</li>
                  <li>{plan.limits.executionsPerMonth.toLocaleString()} executions / month</li>
                  <li>{plan.limits.members.toLocaleString()} workspace members</li>
                  {plan.features.slice(0, 3).map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <Button
                  variant={isCurrent ? 'outline' : 'default'}
                  size="sm"
                  disabled={isCurrent || !canManage || busy}
                  onClick={() => onChangePlan(plan.id)}
                >
                  {isCurrent ? 'Current plan' : `Switch to ${plan.id}`}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

export default PlanComparison;