import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import type { GrowthFunnelDTO } from '@/services/growthApi';

export function FunnelChart({ funnel }: { funnel: GrowthFunnelDTO }) {
  const max = Math.max(...funnel.steps.map((step) => step.count), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Acquisition funnel</CardTitle>
        <CardDescription>Step counts with conversion from the previous step</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {funnel.steps.map((step) => (
          <div key={step.event}>
            <div className="flex items-center justify-between text-xs text-gray-600">
              <span>{step.event.replace(/_/g, ' ').toLowerCase()}</span>
              <span>
                {step.count.toLocaleString()}
                {step.conversionFromPrevious !== null ? ` · ${step.conversionFromPrevious}%` : ''}
              </span>
            </div>
            <div
              role="meter"
              aria-label={`${step.event.replace(/_/g, ' ').toLowerCase()} funnel count`}
              aria-valuenow={step.count}
              aria-valuemin={0}
              aria-valuemax={max}
              className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100"
            >
              <div
                className="h-full bg-emerald-500"
                style={{ width: `${Math.round((step.count / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
