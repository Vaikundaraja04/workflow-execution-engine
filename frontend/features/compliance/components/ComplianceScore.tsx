import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import type { ComplianceReportDTO, ComplianceSectionStatusDTO } from '@/services/enterpriseOperationsApi';

function statusVariant(status: ComplianceSectionStatusDTO): 'success' | 'warning' | 'secondary' {
  if (status === 'OK') return 'success';
  if (status === 'WARN') return 'warning';
  return 'secondary';
}

export function ComplianceScore({ report }: { report: ComplianceReportDTO }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Compliance score</CardTitle>
        <CardDescription>
          Posture for this window folded from recorded evidence - a section without evidence reports
          UNKNOWN and its weight is named in the notes instead of being scored
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs uppercase text-gray-500">Score</p>
            <p className="text-2xl font-semibold text-gray-900">{report.score} / 100</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500">Grade</p>
            <p className="text-2xl font-semibold text-gray-900">{report.grade}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500">Window</p>
            <p>{report.window.days} days</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500">Scope</p>
            <p>{report.workspaceId ?? 'Platform-wide'}</p>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Section</TableHead>
              <TableHead>Weight</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.sections.map((section) => (
              <TableRow key={section.key}>
                <TableCell>{section.label}</TableCell>
                <TableCell>{section.weight}</TableCell>
                <TableCell>{section.score}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(section.status)}>{section.status}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {report.notes.length > 0 && (
          <ul className="space-y-1 text-xs text-gray-500">
            {report.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-gray-400">
          Generated {new Date(report.generatedAt).toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}
