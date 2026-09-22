import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { formatMoney } from '@/features/marketing/components/PackageCatalog';
import type { SalesIntelligenceReportDTO, SalesLeadIntelligenceDTO } from '@/services/growthApi';

const BAND_VARIANTS = {
  HOT: 'destructive',
  WARM: 'warning',
  NURTURE: 'info',
  COLD: 'secondary',
} as const;

export function SalesPipeline({ report }: { report: SalesIntelligenceReportDTO }) {
  const top = [...report.leads].sort((a, b) => b.score - a.score).slice(0, 5);
  const summary = report.summary;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Sales pipeline</CardTitle>
        <CardDescription>
          {summary.total} leads ranked by score · average {summary.averageScore} ·{' '}
          {formatMoney(summary.pipelineValueMonthly, 'usd')} tracked monthly value
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-gray-500">
          {summary.bands.hot} hot · {summary.bands.warm} warm · {summary.bands.nurture} nurture ·{' '}
          {summary.bands.cold} cold · follow-ups: {summary.followUps.overdue} overdue,{' '}
          {summary.followUps.due} due
        </p>
        {top.length === 0 ? (
          <p className="text-sm text-gray-500">No leads in the pipeline yet.</p>
        ) : (
          <ul className="space-y-2">
            {top.map((lead: SalesLeadIntelligenceDTO) => (
              <li key={lead.leadId} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <p className="font-medium text-gray-900">{lead.company}</p>
                  <p className="text-xs text-gray-500">
                    {lead.recommendations[0]?.action ?? 'No recommendation recorded'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">{lead.score}</span>
                  <Badge variant={BAND_VARIANTS[lead.band]}>{lead.band}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
