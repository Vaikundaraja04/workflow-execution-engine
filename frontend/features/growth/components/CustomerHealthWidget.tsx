import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import type { CustomerSuccessPortfolioDTO, CustomerSuccessReportDTO } from '@/services/growthApi';

const CATEGORY_VARIANTS = {
  Healthy: 'success',
  'At Risk': 'warning',
  Critical: 'destructive',
} as const;

export function CustomerHealthWidget({ portfolio }: { portfolio: CustomerSuccessPortfolioDTO }) {
  const highlighted = [...portfolio.customers].sort((a, b) => a.score - b.score).slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Customer health</CardTitle>
        <CardDescription>
          {portfolio.summary.total} customers scored by the success layer · average score{' '}
          {portfolio.summary.averageScore}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs uppercase text-gray-500">Healthy</p>
            <p className="text-2xl font-semibold text-gray-900">{portfolio.summary.healthy}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500">At risk</p>
            <p className="text-2xl font-semibold text-gray-900">{portfolio.summary.atRisk}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500">Critical</p>
            <p className="text-2xl font-semibold text-gray-900">{portfolio.summary.critical}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500">Failing workflows</p>
            <p className="text-2xl font-semibold text-gray-900">{portfolio.summary.failingWorkflows}</p>
          </div>
        </div>
        {highlighted.length === 0 ? (
          <p className="text-sm text-gray-500">No customers to evaluate yet.</p>
        ) : (
          <table className="min-w-full divide-y text-sm">
            <thead>
              <tr>
                <th scope="col" className="py-2 text-left font-medium text-gray-500">Customer</th>
                <th scope="col" className="py-2 text-right font-medium text-gray-500">Score</th>
                <th scope="col" className="py-2 text-right font-medium text-gray-500">Active users</th>
                <th scope="col" className="py-2 text-right font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y text-gray-700">
              {highlighted.map((customer: CustomerSuccessReportDTO) => (
                <tr key={customer.workspaceId}>
                  <td className="py-2">{customer.companyName}</td>
                  <td className="py-2 text-right">{customer.score}</td>
                  <td className="py-2 text-right">
                    {customer.adoption.activeUsers} of {customer.adoption.totalMembers}
                  </td>
                  <td className="py-2 text-right">
                    <Badge variant={CATEGORY_VARIANTS[customer.category]}>{customer.category}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
