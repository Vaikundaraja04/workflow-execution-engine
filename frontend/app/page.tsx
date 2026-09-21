import * as React from 'react';
import Link from 'next/link';
import { MarketingShell } from '@/features/marketing/components/MarketingShell';
import { CallToAction, FeatureGrid, MarketingHero } from '@/features/marketing/components/MarketingSections';

const HIGHLIGHTS = [
  {
    title: 'AI workflow automation',
    description:
      'Describe the process, generate a workflow draft, review it and publish an immutable version.',
  },
  {
    title: 'AI agents',
    description:
      'Register agents with scoped tools and run them against workflows, with run history per agent.',
  },
  {
    title: 'Autonomous execution',
    description:
      'Queued executions with retries, replay, cancellation and a dead-letter queue for the failures that need a human.',
  },
  {
    title: 'Governance',
    description:
      'Policies gate models and features on publish and execution, and every decision lands in the audit trail.',
  },
  {
    title: 'Enterprise reliability',
    description:
      'Durable execution state, workspace isolation, role-based access and hash-chained audit records.',
  },
  {
    title: 'Metered commercial plans',
    description:
      'Usage is metered per workspace against plan limits, with a customer console for plans and billing.',
  },
];

export const metadata = {
  title: 'Workflow Execution Engine',
  description:
    'Durable workflow automation with AI agents, governance and metered plans for SaaS teams.',
};

export default function HomePage() {
  return (
    <MarketingShell>
      <MarketingHero
        eyebrow="Workflow automation platform"
        title="Automate the work that has to be reliable"
        description="A durable execution engine for workflows and AI agents, with the governance, audit and metering a commercial product needs."
      >
        <div className="flex flex-wrap gap-3">
          <Link
            href="/register"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            Create a workspace
          </Link>
          <Link
            href="/features"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Explore the platform
          </Link>
        </div>
      </MarketingHero>

      <FeatureGrid features={HIGHLIGHTS} />

      <CallToAction
        title="Start free, upgrade when you outgrow it"
        description="The free plan includes the full engine, with paid plans raising execution, member and storage limits."
      />
    </MarketingShell>
  );
}
