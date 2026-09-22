import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import type { ComplianceSectionDTO } from '@/services/enterpriseOperationsApi';

export function AuditCoverage({ section }: { section: ComplianceSectionDTO }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Audit coverage</CardTitle>
        <CardDescription>
          Distinct recorded actions in the window against the expected control checklist
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-gray-500">Entries</p>
            <p>{section.evidence.entries ?? 0}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Distinct actions</p>
            <p>{section.evidence.distinctActions ?? 0}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Covered actions</p>
            <p>
              {section.evidence.coveredActions ?? 0} of {section.evidence.expectedActions ?? 0}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Section</p>
            <p>
              {section.status} · score {section.score}
            </p>
          </div>
        </div>
        {section.findings.length === 0 ? (
          <p className="text-sm text-gray-500">No audit findings recorded in this window.</p>
        ) : (
          <ul className="space-y-1 text-sm text-gray-700">
            {section.findings.map((finding) => (
              <li key={finding}>{finding}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
