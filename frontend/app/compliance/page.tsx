'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ErrorState } from '@/components/ui/ErrorState';
import { Loading } from '@/components/ui/Loading';
import { useResource } from '@/hooks/useResource';
import { AuditCoverage } from '@/features/compliance/components/AuditCoverage';
import { ComplianceScore } from '@/features/compliance/components/ComplianceScore';
import { SecurityControls } from '@/features/compliance/components/SecurityControls';
import { enterpriseOperationsApi } from '@/services/enterpriseOperationsApi';

const WINDOWS = [7, 30, 90] as const;

export default function ComplianceCenterPage() {
  const [days, setDays] = useState<number>(30);
  const [scope, setScope] = useState('');
  const [draft, setDraft] = useState('');
  const load = useCallback(
    () => enterpriseOperationsApi.getComplianceCenter({
      days,
      ...(scope.trim() !== '' ? { workspaceId: scope.trim() } : {}),
    }),
    [days, scope],
  );
  const compliance = useResource(load);
  const report = compliance.data;
  const auditSection = report?.sections.find((section) => section.key === 'auditCoverage');
  const securitySection = report?.sections.find((section) => section.key === 'securityControls');

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compliance center</h1>
          <p className="mt-1 text-sm text-gray-500">
            The platform posture next to the SOC2 / GDPR / ISO evidence reports: what was actually
            recorded in the window, with UNKNOWN sections named instead of scored.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            Window
            <select
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm"
            >
              {WINDOWS.map((value) => (
                <option key={value} value={value}>
                  Last {value} days
                </option>
              ))}
            </select>
          </label>
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setScope(draft);
            }}
          >
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Own workspace"
              aria-label="Workspace scope"
            />
            <Button type="submit" variant="outline" size="sm">
              Apply
            </Button>
          </form>
        </div>
      </div>
      {compliance.isLoading ? (
        <Loading message="Loading the compliance posture..." />
      ) : compliance.error || !report ? (
        <ErrorState
          title="Could not load the compliance posture"
          message={compliance.error?.message}
          onRetry={compliance.reload}
        />
      ) : (
        <>
          <ComplianceScore report={report} />
          <div className="grid gap-6 lg:grid-cols-2">
            {auditSection && <AuditCoverage section={auditSection} />}
            {securitySection && <SecurityControls section={securitySection} />}
          </div>
        </>
      )}
    </div>
  );
}
