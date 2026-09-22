import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import type { ComplianceSectionDTO } from '@/services/enterpriseOperationsApi';

export function SecurityControls({ section }: { section: ComplianceSectionDTO }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Security controls</CardTitle>
        <CardDescription>
          Read from the recorded security events in the window - no parallel scanner
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-gray-500">Events</p>
            <p>{section.evidence.events ?? 0}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Open high severity</p>
            <p>{section.evidence.openHighSeverity ?? 0}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Resolved</p>
            <p>{section.evidence.resolved ?? 0}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Section</p>
            <p>
              {section.status} · score {section.score}
            </p>
          </div>
        </div>
        {section.findings.length === 0 ? (
          <p className="text-sm text-gray-500">No security findings recorded in this window.</p>
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
