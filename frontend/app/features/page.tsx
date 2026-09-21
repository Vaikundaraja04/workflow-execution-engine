import * as React from 'react';
import { MarketingShell } from '@/features/marketing/components/MarketingShell';
import { CallToAction, FeatureGrid, MarketingHero } from '@/features/marketing/components/MarketingSections';

const FEATURES = [
  {
    title: 'Durable workflow automation',
    description:
      'Author workflows as versioned definitions, publish immutable versions and execute them with durable state stored in MongoDB.',
  },
  {
    title: 'Queued execution with retries',
    description:
      'Executions run through BullMQ workers with retry policies, cancellation, replay and a dead-letter queue for failures.',
  },
  {
    title: 'AI workflow generation',
    description:
      'Generate and optimise workflow drafts from natural language, with cost and token usage tracked per workspace.',
  },
  {
    title: 'Autonomous agents',
    description:
      'Register agents, give them tool access and run them against your workflows with per-agent run history.',
  },
  {
    title: 'Governance and policies',
    description:
      'Model and agent policies gate what can be published or executed, and every decision is written to the audit trail.',
  },
  {
    title: 'Metered usage and entitlements',
    description:
      'Executions, AI tokens, agent runs, API requests and storage are metered per plan, with quota alerts before limits are hit.',
  },
];

export const metadata = {
  title: 'Features — Workflow Execution Engine',
  description:
    'Workflow automation, AI agents, governance and metered usage in one execution platform.',
};

export default function FeaturesPage() {
  return (
    <MarketingShell>
      <MarketingHero
        eyebrow="Features"
        title="Automation, agents and governance in one engine"
        description="The platform combines a durable workflow engine with an AI layer, agent runtime and the controls operations teams need to run them."
      />
      <FeatureGrid features={FEATURES} />
      <CallToAction
        title="See the platform with your own data"
        description="Create a workspace, publish a workflow and watch the execution trail."
      />
    </MarketingShell>
  );
}
