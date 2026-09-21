'use client';

import React from 'react';
import type { IndexVerificationReportDTO, IndexVerificationEntryDTO } from '@/types/releaseReadiness';

const STATUS_CLASSES: Record<IndexVerificationEntryDTO['status'], string> = {
  HEALTHY: 'bg-green-100 text-green-800',
  WARN: 'bg-yellow-100 text-yellow-800',
  FAIL: 'bg-red-100 text-red-800',
};

export function DatabaseHealth({ report }: { report: IndexVerificationReportDTO }) {
  return (
    <section data-testid="database-health" className="rounded-lg border bg-white p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Database Health</h2>
        <span className="text-sm font-medium">
          {report.verdict} ({report.score}/100)
        </span>
      </header>
      <ul className="space-y-2 text-sm">
        {report.collections.map((collection) => (
          <li key={collection.collection} className="flex items-start gap-2">
            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_CLASSES[collection.status]}`}>
              {collection.status}
            </span>
            <span>
              <span className="font-medium">{collection.collection}</span>
              <span className="text-gray-500">
                {' '}- {collection.count} documents
                {collection.avgDocumentBytes !== null ? `, avg ${collection.avgDocumentBytes} bytes` : ''}
              </span>
              {collection.issues.map((issue) => (
                <span key={issue} className="block text-gray-500">
                  {issue}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {report.recommendations.length > 0 ? (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold">Recommendations</h3>
          <ul data-testid="database-recommendations" className="list-disc space-y-1 pl-5 text-sm text-gray-600">
            {report.recommendations.map((recommendation) => (
              <li key={recommendation}>{recommendation}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export default DatabaseHealth;
