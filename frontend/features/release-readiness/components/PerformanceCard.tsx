'use client';

import React from 'react';
import type { PerformanceBenchmarkReportDTO, BenchmarkVerdict } from '@/types/releaseReadiness';

const VERDICT_CLASSES: Record<BenchmarkVerdict, string> = {
  PASS: 'bg-green-100 text-green-800',
  WARN: 'bg-yellow-100 text-yellow-800',
  FAIL: 'bg-red-100 text-red-800',
};

export function PerformanceCard({ report }: { report: PerformanceBenchmarkReportDTO }) {
  return (
    <section data-testid="performance-card" className="rounded-lg border bg-white p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Performance Benchmark</h2>
        <span className={`rounded px-2 py-1 text-xs font-semibold ${VERDICT_CLASSES[report.verdict]}`}>
          {report.verdict}
        </span>
      </header>
      <p className="mb-3 text-sm text-gray-600">
        Score {report.score}
        {report.slowest ? ` | slowest ${report.slowest.id} at ${report.slowest.medianMs} ms` : ''}
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2">Operation</th>
              <th className="p-2">Median</th>
              <th className="p-2">Worst</th>
              <th className="p-2">Threshold</th>
              <th className="p-2">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {report.operations.map((operation) => (
              <tr key={operation.id} className="border-t">
                <td className="p-2">{operation.label}</td>
                <td className="p-2">{operation.medianMs} ms</td>
                <td className="p-2">{operation.worstMs} ms</td>
                <td className="p-2">{operation.thresholdMs} ms</td>
                <td className="p-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${VERDICT_CLASSES[operation.verdict]}`}>
                    {operation.verdict}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default PerformanceCard;
