'use client';

import React from 'react';
import type { DeploymentValidationReportDTO } from '@/types/releaseReadiness';

export function DeploymentStatus({ report }: { report: DeploymentValidationReportDTO }) {
  return (
    <section data-testid="deployment-status" className="rounded-lg border bg-white p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Deployment Readiness</h2>
        <span className="text-sm font-medium">
          {report.verdict} ({report.score}/100)
        </span>
      </header>
      <p className="mb-3 text-xs text-gray-500">Manifests: {report.manifestDirectory}</p>
      <ul data-testid="deployment-files" className="space-y-1 text-sm">
        {report.files.map((file) => (
          <li key={file.file} className="flex items-center gap-2">
            <span className={file.ok ? 'text-green-600' : 'text-red-600'}>{file.ok ? 'OK' : 'FAIL'}</span>
            <span>{file.file}</span>
            {file.missing.length > 0 ? (
              <span className="text-red-600">missing: {file.missing.join(', ')}</span>
            ) : null}
          </li>
        ))}
      </ul>
      <h3 className="mt-4 mb-2 text-sm font-semibold">Queue and worker checks</h3>
      <ul className="space-y-1 text-sm">
        {report.queueWorkerChecks.map((check) => (
          <li key={check.id} className="flex items-center gap-2">
            <span className={check.ok ? 'text-green-600' : 'text-red-600'}>{check.ok ? 'OK' : 'FAIL'}</span>
            <span>{check.details}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default DeploymentStatus;
