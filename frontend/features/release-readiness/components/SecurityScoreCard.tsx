'use client';

import React from 'react';
import type { SecurityAuditReportDTO, SecurityFindingStatus } from '@/types/releaseReadiness';

const STATUS_CLASSES: Record<SecurityFindingStatus, string> = {
  PASS: 'bg-green-100 text-green-800',
  WARN: 'bg-yellow-100 text-yellow-800',
  FAIL: 'bg-red-100 text-red-800',
};

export function SecurityScoreCard({ report }: { report: SecurityAuditReportDTO }) {
  return (
    <section data-testid="security-score-card" className="rounded-lg border bg-white p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Security Audit</h2>
        <span data-testid="security-score" className="text-2xl font-bold">{report.score}</span>
      </header>
      <p className="mb-3 text-sm text-gray-600">
        {report.summary.passed} passed | {report.summary.warnings} warnings | {report.summary.failures} failures
      </p>
      <ul className="space-y-2">
        {report.findings.map((finding) => (
          <li key={finding.id} className="flex items-start gap-2 text-sm">
            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_CLASSES[finding.status]}`}>
              {finding.status}
            </span>
            <span>
              <span className="font-medium">{finding.title}</span>
              <span className="text-gray-500"> - {finding.details}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default SecurityScoreCard;
