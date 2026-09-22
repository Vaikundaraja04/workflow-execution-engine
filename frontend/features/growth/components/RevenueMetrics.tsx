import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { formatMoney } from '@/features/marketing/components/PackageCatalog';
import type { BusinessAnalyticsReportDTO } from '@/services/businessAnalyticsApi';
import type { GrowthConversionDTO, GrowthRetentionDTO } from '@/services/growthApi';

export function RevenueMetrics({
  revenue,
  conversion,
  retention,
}: {
  revenue: BusinessAnalyticsReportDTO['revenue'];
  conversion: GrowthConversionDTO;
  retention: GrowthRetentionDTO;
}) {
  const cac = conversion.cac.costPerAcquisition;
  const lifetimeMonths = retention.ltv.estimatedLifetimeMonths;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Revenue metrics</CardTitle>
        <CardDescription>
          MRR from the priced catalog; CAC, activation, churn and LTV from recorded payments and events
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs uppercase text-gray-500">MRR</p>
            <p className="text-2xl font-semibold text-gray-900">{formatMoney(revenue.mrr, revenue.currency)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500">ARR</p>
            <p className="text-2xl font-semibold text-gray-900">{formatMoney(revenue.arr, revenue.currency)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500">ARPA</p>
            <p className="text-2xl font-semibold text-gray-900">{formatMoney(revenue.arpa, revenue.currency)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500">CAC</p>
            <p className="text-2xl font-semibold text-gray-900">
              {cac !== null ? formatMoney(cac, conversion.cac.currency) : 'Not reported'}
            </p>
          </div>
        </div>
        <div className="grid gap-4 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-gray-500">Activation</p>
            <p>
              {conversion.activation.activated} of {conversion.activation.evaluated} (
              {conversion.activation.activationRatePercent}%)
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Trial to paid</p>
            <p>{conversion.rates.trialToPaidPercent}%</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Churn rate</p>
            <p>
              {retention.churn.churnRatePercent}% ({retention.churn.churnedInWindow} churned)
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">LTV lifetime</p>
            <p>{lifetimeMonths !== null ? `${lifetimeMonths} months` : 'Not estimable'}</p>
          </div>
        </div>
        <p className="text-xs text-gray-500">
          {conversion.cac.note}. {retention.ltv.note}
        </p>
      </CardContent>
    </Card>
  );
}
