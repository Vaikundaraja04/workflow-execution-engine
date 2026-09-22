import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { formatMoney } from '@/features/marketing/components/PackageCatalog';
import type { PublisherDashboardDTO } from '@/services/marketplaceEcosystemApi';

export function PublisherOverview({ dashboard }: { dashboard: PublisherDashboardDTO }) {
  const currency = dashboard.revenue.recent[0]?.currency ?? 'usd';
  const totals = dashboard.revenue.totals;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Publisher overview</CardTitle>
        <CardDescription>
          Revenue, payouts and licenses folded from recorded marketplace transactions for this workspace
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs uppercase text-gray-500">Gross sales</p>
            <p className="text-2xl font-semibold text-gray-900">
              {formatMoney(totals.grossSales, currency)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500">Platform commission</p>
            <p className="text-2xl font-semibold text-gray-900">
              {formatMoney(totals.platformRevenue, currency)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500">Publisher earnings</p>
            <p className="text-2xl font-semibold text-gray-900">
              {formatMoney(totals.publisherEarnings, currency)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500">Available payout</p>
            <p className="text-2xl font-semibold text-gray-900">
              {formatMoney(dashboard.payouts.available, currency)}
            </p>
          </div>
        </div>        <div className="grid gap-4 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-gray-500">Transactions</p>
            <p>{totals.transactions}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Refunded</p>
            <p>{formatMoney(totals.refunded, currency)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Active licenses</p>
            <p>
              {dashboard.licenses.active} ({dashboard.licenses.byAssetType.AGENT} agents,{' '}
              {dashboard.licenses.byAssetType.WORKFLOW} workflows)
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Average rating</p>
            <p>
              {dashboard.ratings.count > 0
                ? `${dashboard.ratings.average.toFixed(1)} from ${dashboard.ratings.count} review(s)`
                : 'No reviews recorded yet'}
            </p>
          </div>
        </div>
        {dashboard.notes.length > 0 && (
          <ul className="space-y-1 text-xs text-gray-500">
            {dashboard.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-gray-400">
          Window: last {dashboard.window.days} days · generated{' '}
          {new Date(dashboard.generatedAt).toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}