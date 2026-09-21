import * as React from 'react';
import Link from 'next/link';
import { MarketingShell } from '@/features/marketing/components/MarketingShell';
import { CallToAction, MarketingHero } from '@/features/marketing/components/MarketingSections';

const SECTIONS = [
  {
    title: 'Getting started',
    description: 'Create an account, name your workspace and land in the dashboard.',
    links: [
      { href: '/register', label: 'Create an account' },
      { href: '/login', label: 'Sign in' },
      { href: '/dashboard', label: 'Dashboard' },
    ],
  },
  {
    title: 'Workflows',
    description: 'Build, validate and publish workflow definitions.',
    links: [
      { href: '/workflows/new', label: 'New workflow' },
      { href: '/executions', label: 'Executions' },
      { href: '/dead-letters', label: 'Dead letters' },
    ],
  },
  {
    title: 'AI and agents',
    description: 'Generate, optimise and run AI-native automation.',
    links: [
      { href: '/ai/workflow-generator', label: 'AI workflow generator' },
      { href: '/agents', label: 'Agents' },
      { href: '/operations', label: 'Operations' },
    ],
  },
  {
    title: 'Account and billing',
    description: 'Manage the plan, metered usage and workspace settings.',
    links: [
      { href: '/customer', label: 'Customer console' },
      { href: '/customer/subscription', label: 'Subscription' },
      { href: '/customer/usage', label: 'Usage' },
      { href: '/customer/settings', label: 'Settings' },
    ],
  },
  {
    title: 'Security',
    description: 'Audit, compliance and workspace security policy.',
    links: [
      { href: '/security', label: 'Security console' },
      { href: '/security/audit', label: 'Audit trail' },
      { href: '/security/sessions', label: 'Sessions' },
    ],
  },
  {
    title: 'API',
    description: 'The backend exposes the platform over versioned REST endpoints.',
    links: [
      { href: '/documentation', label: 'Endpoint groups' },
      { href: '/security/secrets', label: 'API keys and secrets' },
    ],
  },
];

export const metadata = {
  title: 'Documentation — Workflow Execution Engine',
  description: 'Entry points for the console surfaces and the API.',
};

export default function DocumentationPage() {
  return (
    <MarketingShell>
      <MarketingHero
        eyebrow="Documentation"
        title="Find your way around the platform"
        description="Short entry points into the working surfaces. Each link opens the console route that owns that capability."
      />

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 lg:px-8">
        {SECTIONS.map((section) => (
          <div key={section.title} className="rounded-xl border border-slate-200 p-5">
            <h2 className="text-base font-semibold text-slate-900">{section.title}</h2>
            <p className="mt-2 text-sm text-slate-600">{section.description}</p>
            <ul className="mt-4 space-y-2">
              {section.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm font-medium text-emerald-700 hover:text-emerald-800"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <CallToAction
        title="Looking for the API surface?"
        description="The backend exposes versioned REST endpoints for workflows, executions, usage and customer management."
      />
    </MarketingShell>
  );
}
