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
import type { MarketplaceAnalyticsReportDTO } from '@/services/marketplaceEcosystemApi';

function primaryCurrency(report: MarketplaceAnalyticsReportDTO): string {
  return Object.keys(report.gmv.byCurrency)[0] ?? 'usd';
}

export function MarketplaceAnalyticsDashboard({ report }: { report: MarketplaceAnalyticsReportDTO }) {
  const currency = primaryCurrency(report);
  const gmv = report.gmv;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Ecosystem GMV</CardTitle>
          <CardDescription>
            Cross-tenant marketplace volume for the selected window, folded from recorded transactions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <p className="text-xs uppercase text-gray-500">Gross sales</p>
              <p className="text-2xl font-semibold text-gray-900">
                {formatMoney(gmv.grossSales, currency)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-gray-500">Net of refunds</p>
              <p className="text-2xl font-semibold text-gray-900">
                {formatMoney(gmv.netGrossSales, currency)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-gray-500">Platform revenue</p>
              <p className="text-2xl font-semibold text-gray-900">
                {formatMoney(gmv.platformRevenue, currency)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-gray-500">Publisher earnings</p>
              <p className="text-2xl font-semibold text-gray-900">
                {formatMoney(gmv.publisherEarnings, currency)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-gray-500">Refunded</p>
              <p className="text-2xl font-semibold text-gray-900">
                {formatMoney(gmv.refunded, currency)}
              </p>
            </div>
          </div>          <div className="grid gap-4 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs text-gray-500">Transactions</p>
              <p>{gmv.transactions}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Active licenses</p>
              <p>{report.licenses.active}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Publishers</p>
              <p>{report.adoption.publishers}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">License holders</p>
              <p>{report.adoption.activeLicenseHolders}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Adoption and top assets</CardTitle>
          <CardDescription>
            Listings, installs and the best selling assets in the window - empty windows report zeros
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 text-sm text-gray-700 sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <p className="text-xs text-gray-500">Agent listings</p>
              <p>{report.adoption.agentListings}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Workflow listings</p>
              <p>{report.adoption.workflowListings}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Agent installs</p>
              <p>{report.adoption.agentInstalls}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Workflow installs</p>
              <p>{report.adoption.workflowInstalls}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Agent licenses</p>
              <p>{report.licenses.byAssetType.AGENT ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Workflow licenses</p>
              <p>{report.licenses.byAssetType.WORKFLOW ?? 0}</p>
            </div>
          </div>          {report.topAssets.length === 0 ? (
            <p className="text-sm text-gray-500">No asset sales recorded in this window.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Sales</TableHead>
                  <TableHead>Gross sales</TableHead>
                  <TableHead>Publisher earnings</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.topAssets.map((asset) => (
                  <TableRow key={`${asset.assetType}-${asset.assetId}`}>
                    <TableCell>{asset.name}</TableCell>
                    <TableCell>{asset.assetType}</TableCell>
                    <TableCell>{asset.sales}</TableCell>
                    <TableCell>{formatMoney(asset.grossSales, currency)}</TableCell>
                    <TableCell>{formatMoney(asset.publisherEarnings, currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Publisher growth</CardTitle>
          <CardDescription>
            New and active publishers per month, counted from the first and latest recorded sales
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {report.publisherGrowth.length === 0 ? (
            <p className="text-sm text-gray-500">No publisher activity recorded.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead>New publishers</TableHead>
                  <TableHead>Active publishers</TableHead>
                  <TableHead>Gross sales</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.publisherGrowth.map((point) => (
                  <TableRow key={point.month}>
                    <TableCell>{point.month}</TableCell>
                    <TableCell>{point.newPublishers}</TableCell>
                    <TableCell>{point.activePublishers}</TableCell>
                    <TableCell>{formatMoney(point.grossSales, currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {report.notes.length > 0 && (
            <ul className="space-y-1 text-xs text-gray-500">
              {report.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-400">
            Window: last {report.window.days} days · generated{' '}
            {new Date(report.generatedAt).toLocaleString()}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}