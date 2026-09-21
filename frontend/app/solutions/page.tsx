import * as React from 'react';
import { MarketingShell } from '@/features/marketing/components/MarketingShell';
import { CallToAction, FeatureGrid, MarketingHero } from '@/features/marketing/components/MarketingSections';

const SOLUTIONS = [
  {
    title: 'Operations teams',
    description:
      'Model approval and hand-off steps as workflows, schedule them, and monitor failures from the execution console and dead-letter queue.',
  },
  {
    title: 'Platform engineering',
    description:
      'Run the engine in your own deployment, manage API keys and webhooks per workspace, and integrate through the REST API.',
  },
  {
    title: 'AI and automation teams',
    description:
      'Generate workflow drafts with AI, publish reviewed versions, and give agents scoped tools with run history per agent.',
  },
  {
    title: 'Security and compliance',
    description:
      'Enforce role-based access, workspace isolation and governance policies, and export the hash-chained audit log for review.',
  },
  {
    title: 'Customer-facing SaaS',
    description:
      'Offer plans with metered limits, track usage against entitlements and let customers manage their own subscription.',
  },
  {
    title: 'Internal platform teams',
    description:
      'Give product teams self-serve workspaces while platform operators keep a customer-level view of subscriptions and usage.',
  },
];

export const metadata = {
  title: 'Solutions — Workflow Execution Engine',
  description: 'How teams use the workflow engine, AI layer and governance controls.',
};

export default function SolutionsPage() {
  return (
    <MarketingShell>
      <MarketingHero
        eyebrow="Solutions"
        title="Built for the teams that run automation"
        description="From operations workflows to customer-facing automation products, the engine covers execution, oversight and billing in one place."
      />
      <FeatureGrid features={SOLUTIONS} />
      <CallToAction
        title="Start with a workspace"
        description="Bring one workflow, then grow into agents, governance and metered plans."
      />
    </MarketingShell>
  );
}
