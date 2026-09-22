'use client';

import * as React from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MarketingShell } from '@/features/marketing/components/MarketingShell';
import { MarketingHero } from '@/features/marketing/components/MarketingSections';
import { LeadForm } from '@/features/marketing/components/LeadForm';
import type { LeadFormValues } from '@/features/marketing/components/LeadForm';
import { marketingApi } from '@/services/marketingApi';
import type { DemoWorkspaceDTO } from '@/services/marketingApi';
import type { ApiClientError } from '@/services/apiClient';
import { useAuthStore } from '@/stores/authStore';

export default function DemoPage() {
  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sandbox, setSandbox] = useState<DemoWorkspaceDTO | null>(null);

  const requestDemo = async (values: LeadFormValues) => {
    setBusy(true);
    setError(null);
    try {
      await marketingApi.captureLead({ ...values, source: 'DEMO_REQUEST' });
      const demo = await marketingApi.createDemoWorkspace();
      setSandbox(demo);
    } catch (err) {
      setError((err as ApiClientError)?.message ?? 'The demo request failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const openSandbox = () => {
    if (!sandbox) return;
    setAuth({
      accessToken: sandbox.tokens.accessToken,
      refreshToken: sandbox.tokens.refreshToken,
      defaultWorkspaceId: sandbox.workspaceId,
    });
    router.push('/dashboard');
  };

  return (
    <MarketingShell>
      <MarketingHero
        eyebrow="Demo"
        title="Request a demo and open a sandbox immediately"
        description="Tell us what you want to automate. We capture the request for the team and provision a temporary workspace so you can try the engine yourself right away."
      />

      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8" aria-label="Demo request">
        {sandbox ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
            <h2 className="text-lg font-semibold text-emerald-900">Your sandbox is ready</h2>
            <p className="mt-2 text-sm text-emerald-800">
              Workspace {sandbox.workspaceId} is provisioned with {sandbox.workflowIds.length}{' '}
              starter workflows and {sandbox.agentIds.length} agents. It expires on{' '}
              {new Date(sandbox.demoExpiresAt).toLocaleDateString()}.
            </p>
            <button
              type="button"
              onClick={openSandbox}
              className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              Open your sandbox
            </button>
          </div>
        ) : (
          <>
            {error ? (
              <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            ) : null}
            <LeadForm
              submitLabel="Request demo and open sandbox"
              busy={busy}
              onSubmit={requestDemo}
            />
          </>
        )}
      </section>
    </MarketingShell>
  );
}
