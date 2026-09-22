import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import type { GrowthFunnelDTO } from '@/services/growthApi';

export function GrowthOverview({ funnel }: { funnel: GrowthFunnelDTO }) {
  const stats = [
    { label: 'Visitors', value: funnel.totals.visitors },
    { label: 'Signups', value: funnel.totals.signups },
    { label: 'Demos', value: funnel.totals.demos },
    { label: 'Trials', value: funnel.totals.trials },
    { label: 'Payments', value: funnel.totals.payments },
    { label: 'Customers', value: funnel.totals.customers },
    { label: 'Churned', value: funnel.totals.churned },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Growth overview</CardTitle>
        <CardDescription>
          Visitors through retained customers over the last {funnel.window.days} days, read from the growth ledger
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          {stats.map((stat) => (
            <div key={stat.label}>
              <p className="text-xs uppercase text-gray-500">{stat.label}</p>
              <p className="text-2xl font-semibold text-gray-900">{stat.value.toLocaleString()}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          {funnel.rates.visitorToSignupPercent}% visitor to signup ·{' '}
          {funnel.rates.signupToDemoPercent}% signup to demo ·{' '}
          {funnel.rates.demoToCustomerPercent}% demo to customer ·{' '}
          {funnel.rates.trialToCustomerPercent}% trial to customer ·{' '}
          {funnel.rates.customerToChurnPercent}% customer churn
        </p>
      </CardContent>
    </Card>
  );
}
