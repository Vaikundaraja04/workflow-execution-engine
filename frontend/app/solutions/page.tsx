'use client';

import * as React from 'react';
import { MarketingShell } from '@/features/marketing/components/MarketingShell';
import { CallToAction, MarketingHero } from '@/features/marketing/components/MarketingSections';
import { SolutionCatalog } from '@/features/marketing/components/SolutionCatalog';
import { useResource } from '@/hooks/useResource';
import { marketingApi } from '@/services/marketingApi';
import { Loading } from '@/components/ui/Loading';
import { ErrorState } from '@/components/ui/ErrorState';

const loadSolutions = () => marketingApi.getSolutions();

export default function SolutionsPage() {
  const solutions = useResource(loadSolutions);

  return (
    <MarketingShell>
      <MarketingHero
        eyebrow="Solutions"
        title="Start from a solution, adapt it to your process"
        description="Every solution ships real workflows and agents you can install into your workspace: filter by industry or by the package it is sized for."
      />

      <section
        className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8"
        aria-label="Solution catalog"
      >
        {solutions.isLoading ? (
          <Loading message="Loading solutions..." />
        ) : solutions.error || !solutions.data ? (
          <ErrorState
            title="Could not load the solution catalog"
            message={solutions.error?.message}
            onRetry={solutions.reload}
          />
        ) : (
          <SolutionCatalog solutions={solutions.data} />
        )}
      </section>

      <CallToAction
        title="Install a solution in minutes"
        description="Pick a package, install the workflows and agents, then make the process yours."
      />
    </MarketingShell>
  );
}
