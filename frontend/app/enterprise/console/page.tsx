'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AccountPanel } from '@/features/enterprise-console/components/AccountPanel';
import { BillingPanel } from '@/features/enterprise-console/components/BillingPanel';
import { HealthPanel } from '@/features/enterprise-console/components/HealthPanel';
import { SecurityPanel } from '@/features/enterprise-console/components/SecurityPanel';
import { SupportPanel } from '@/features/enterprise-console/components/SupportPanel';
import { UsagePanel } from '@/features/enterprise-console/components/UsagePanel';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const WINDOWS = [30, 90] as const;

export default function EnterpriseConsolePage() {
  const currentWorkspace = useWorkspaceStore((state) => state.currentWorkspace);
  const [scope, setScope] = useState(currentWorkspace?._id ?? currentWorkspace?.id ?? '');
  const [draft, setDraft] = useState('');
  const [days, setDays] = useState<number>(30);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Enterprise console</h1>
          <p className="mt-1 text-sm text-gray-500">
            The operator view over one workspace: account, usage, health, security, billing and
            support. Every panel states its own window and reports what was recorded - no estimates.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setScope(draft.trim());
            }}
          >
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={scope || 'Workspace id'}
              aria-label="Workspace"
            />
            <Button type="submit" variant="outline" size="sm">
              Load workspace
            </Button>
          </form>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            Billing window
            <select
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm"
            >
              {WINDOWS.map((value) => (
                <option key={value} value={value}>
                  Last {value} days
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <AccountPanel workspaceId={scope} />
      <div className="grid gap-6 lg:grid-cols-2">
        <UsagePanel workspaceId={scope} />
        <HealthPanel workspaceId={scope} />
        <SecurityPanel workspaceId={scope} />
        <SupportPanel workspaceId={scope} />
      </div>
      <BillingPanel days={days} />
    </div>
  );
}
