'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { SolutionSummaryDTO } from '@/services/marketingApi';

const ALL = 'ALL';

export function SolutionCatalog({ solutions }: { solutions: SolutionSummaryDTO[] }) {
  const [industry, setIndustry] = useState(ALL);
  const [packageId, setPackageId] = useState(ALL);

  const industries = useMemo(
    () => [...new Set(solutions.map((solution) => solution.industry))].sort(),
    [solutions],
  );
  const packages = useMemo(
    () => [...new Set(solutions.map((solution) => solution.recommendedPackage))].sort(),
    [solutions],
  );

  const visible = useMemo(
    () =>
      solutions.filter(
        (solution) =>
          (industry === ALL || solution.industry === industry) &&
          (packageId === ALL || solution.recommendedPackage === packageId),
      ),
    [solutions, industry, packageId],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          Industry
          <select
            value={industry}
            onChange={(event) => setIndustry(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
          >
            <option value={ALL}>All industries</option>
            {industries.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          Package
          <select
            value={packageId}
            onChange={(event) => setPackageId(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
          >
            <option value={ALL}>All packages</option>
            {packages.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-slate-200 p-5 text-sm text-slate-600">
          No solutions match these filters yet.
        </p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {visible.map((solution) => (
            <article key={solution.id} className="flex flex-col rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-slate-900">{solution.name}</h2>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                  {solution.industry}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600">{solution.summary}</p>
              <ul className="mt-3 space-y-1 text-sm text-slate-600">
                {solution.outcomes.slice(0, 3).map((outcome) => (
                  <li key={outcome}>{outcome}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-slate-500">
                {solution.workflowCount} workflows · {solution.agentCount} agents · recommended{' '}
                {solution.recommendedPackage}
              </p>
              <Link
                href={`/register?plan=${solution.recommendedPackage}`}
                className="mt-4 self-start rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
              >
                Start with {solution.name}
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export default SolutionCatalog;
