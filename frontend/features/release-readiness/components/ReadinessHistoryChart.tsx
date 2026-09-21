'use client';

import React from 'react';
import type { ReadinessScanDTO } from '@/types/continuousMonitoring';

const VERDICT_COLOURS: Record<ReadinessScanDTO['verdict'], string> = {
  READY: '#16a34a',
  NEEDS_ATTENTION: '#ca8a04',
  NOT_READY: '#dc2626',
};

const CHART_WIDTH = 600;
const CHART_HEIGHT = 160;
const PADDING = 24;

export function ReadinessHistoryChart({ scans }: { scans: ReadinessScanDTO[] }) {
  const points = [...scans].reverse();

  if (points.length === 0) {
    return (
      <section data-testid="readiness-history-chart" className="rounded-lg border bg-white p-4">
        <h2 className="text-lg font-semibold">Readiness history</h2>
        <p className="mt-2 text-sm text-gray-500">No readiness scans recorded yet.</p>
      </section>
    );
  }

  const step = points.length > 1 ? (CHART_WIDTH - PADDING * 2) / (points.length - 1) : 0;
  const coords = points.map((scan, index) => ({
    scan,
    x: PADDING + index * step,
    y: CHART_HEIGHT - PADDING - (scan.score / 100) * (CHART_HEIGHT - PADDING * 2),
  }));
  const line = coords.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  return (
    <section data-testid="readiness-history-chart" className="rounded-lg border bg-white p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Readiness history</h2>
        <span data-testid="readiness-history-count" className="text-sm text-gray-500">
          {points.length} scans
        </span>
      </header>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label="Readiness score history"
        className="w-full"
      >
        <path data-testid="readiness-history-line" d={line} fill="none" stroke="#2563eb" strokeWidth="2" />
        {coords.map((point) => (
          <circle
            key={point.scan.id}
            data-testid={`readiness-point-${point.scan.id}`}
            cx={point.x}
            cy={point.y}
            r="4"
            fill={VERDICT_COLOURS[point.scan.verdict]}
          >
            <title>{`${point.scan.score}/100 ${point.scan.verdict}`}</title>
          </circle>
        ))}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-3 text-xs text-gray-600">
        {coords.map((point) => (
          <li key={point.scan.id}>
            {point.scan.createdAt} - {point.scan.score} ({point.scan.verdict})
          </li>
        ))}
      </ul>
    </section>
  );
}

export default ReadinessHistoryChart;