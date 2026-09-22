import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { formatMoney } from '@/features/marketing/components/PackageCatalog';
import type { PublisherDashboardDTO } from '@/services/marketplaceEcosystemApi';

export function SalesAnalytics({ dashboard }: { dashboard: PublisherDashboardDTO }) {
  const currency = dashboard.revenue.recent[0]?.currency ?? 'usd';
  const { series, recent } = dashboard.revenue;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Sales analytics</CardTitle>
        <CardDescription>
          Monthly settlements and the latest recorded sales - refunds are already subtracted from earnings
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {series.length === 0 ? (
          <p className="text-sm text-gray-500">No sales recorded in this window.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead>Transactions</TableHead>
                <TableHead>Gross sales</TableHead>
                <TableHead>Commission</TableHead>
                <TableHead>Earnings</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {series.map((point) => (
                <TableRow key={point.month}>
                  <TableCell>{point.month}</TableCell>
                  <TableCell>{point.transactions}</TableCell>
                  <TableCell>{formatMoney(point.grossSales, currency)}</TableCell>
                  <TableCell>{formatMoney(point.platformRevenue, currency)}</TableCell>
                  <TableCell>{formatMoney(point.publisherEarnings, currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-900">Recent sales</h3>
          {recent.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing sold yet in this window.</p>
          ) : (
            <ul className="space-y-2 text-sm text-gray-700">
              {recent.map((sale) => (
                <li key={sale.transactionId} className="flex items-center justify-between gap-4">
                  <span className="truncate">
                    {sale.assetType} · {sale.transactionId}
                  </span>
                  <span className="shrink-0 text-gray-500">
                    {formatMoney(sale.amount, sale.currency)} · {sale.status} ·{' '}
                    {new Date(sale.settledAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}