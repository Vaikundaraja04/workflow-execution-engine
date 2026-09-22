import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { formatMoney } from '@/features/marketing/components/PackageCatalog';
import type { PublisherRevenueSeriesPointDTO } from '@/services/marketplaceEcosystemApi';

export function RevenueChart({ series }: { series: PublisherRevenueSeriesPointDTO[] }) {
  const max = Math.max(1, ...series.map((point) => point.grossSales));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Revenue trend</CardTitle>
        <CardDescription>Gross sales and publisher earnings per settled month</CardDescription>
      </CardHeader>
      <CardContent>
        {series.length === 0 ? (
          <p className="text-sm text-gray-500">No settlements to chart yet.</p>
        ) : (
          <ul className="space-y-4">
            {series.map((point) => (
              <li key={point.month} className="space-y-1">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>{point.month}</span>
                  <span>
                    {formatMoney(point.grossSales, 'usd')} gross ·{' '}
                    {formatMoney(point.publisherEarnings, 'usd')} earned
                  </span>
                </div>
                <div className="h-3 w-full rounded bg-gray-100">
                  <div
                    className="h-3 rounded bg-blue-500"
                    style={{ width: `${Math.max(2, Math.round((point.grossSales / max) * 100))}%` }}
                  />
                </div>
                <div className="h-2 w-full rounded bg-gray-100">
                  <div
                    className="h-2 rounded bg-emerald-500"
                    style={{
                      width: `${Math.max(2, Math.round((point.publisherEarnings / max) * 100))}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}