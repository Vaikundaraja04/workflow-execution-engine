'use client';

import React from 'react';
import type { DisasterRecoveryReadinessDTO } from '@/types/releaseReadiness';

function seconds(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

export function DRStatus({ report }: { report: DisasterRecoveryReadinessDTO }) {
  return (
    <section data-testid="dr-status" className="rounded-lg border bg-white p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Disaster Recovery</h2>
        <span
          className={`rounded px-2 py-1 text-xs font-semibold ${
            report.backupStatus.status === 'VALID' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}
        >
          BACKUP {report.backupStatus.status}
        </span>
      </header>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-gray-500">Restore dry-run</dt>
        <dd>{report.restoreTest.valid ? 'VALID' : 'INVALID'}</dd>
        <dt className="text-gray-500">Checksum</dt>
        <dd>{report.restoreTest.checksumValid ? 'VERIFIED' : 'MISMATCH'}</dd>
        <dt className="text-gray-500">Counts match</dt>
        <dd>{report.restoreTest.countsMatch ? 'YES' : 'NO'}</dd>
        <dt className="text-gray-500">Records captured</dt>
        <dd>{report.dataIntegrity.totalRecords}</dd>
        <dt className="text-gray-500">Estimated recovery</dt>
        <dd>{seconds(report.recoveryTimeEstimate.estimatedRecoveryMs)}</dd>
        <dt className="text-gray-500">RTO target</dt>
        <dd>{seconds(report.recoveryTimeEstimate.rtoTargetMs)}</dd>
        <dt className="text-gray-500">RPO target</dt>
        <dd>{seconds(report.recoveryTimeEstimate.rpoTargetMs)}</dd>
        <dt className="text-gray-500">Meets RTO</dt>
        <dd>{report.recoveryTimeEstimate.meetsRto ? 'YES' : 'NO'}</dd>
      </dl>
      {report.restoreTest.errors.length > 0 ? (
        <ul className="mt-3 list-disc pl-5 text-sm text-red-600">
          {report.restoreTest.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export default DRStatus;
