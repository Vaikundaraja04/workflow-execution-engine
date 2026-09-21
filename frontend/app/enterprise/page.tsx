import * as React from 'react';
import { MarketingShell } from '@/features/marketing/components/MarketingShell';
import { CallToAction, FeatureGrid, MarketingHero } from '@/features/marketing/components/MarketingSections';

const PILLARS = [
  {
    title: 'Role-based access control',
    description:
      'Owner, admin, editor and viewer roles with a permission matrix enforced on every workspace-scoped route.',
  },
  {
    title: 'Workspace isolation',
    description:
      'Every resource is scoped to its workspace and tenant; cross-tenant access returns not-found rather than leaking data.',
  },
  {
    title: 'Hash-chained audit log',
    description:
      'State-changing actions are recorded in an append-only audit log with chain verification, and secrets are never written to it.',
  },
  {
    title: 'Governance policies',
    description:
      'Policies block models or features in publish and execution paths, and denials are surfaced with the acting rule.',
  },
  {
    title: 'Subscription lifecycle',
    description:
      'Trials, plan changes, cancellations and expiries are tracked per workspace, with entitlements enforced at the API boundary.',
  },
  {
    title: 'Operator console',
    description:
      'Platform administrators get a customer view covering subscription state, usage pressure and account health.',
  },
];

export const metadata = {
  title: 'Enterprise — Workflow Execution Engine',
  description: 'Access control, tenant isolation, audit and operator tooling for enterprise deployments.',
};

export default function EnterprisePage() {
  return (
    <MarketingShell>
      <MarketingHero
        eyebrow="Enterprise"
        title="Controls that hold up under review"
        description="The platform ships the access, isolation and audit primitives enterprise deployments are assessed on, alongside the customer lifecycle tooling."
      />
      <FeatureGrid features={PILLARS} />
      <CallToAction
        title="Talk through your requirements"
        description="Review the enterprise controls, or start a workspace to evaluate them directly."
      />
    </MarketingShell>
  );
}
