'use client';

import * as React from 'react';
import { useState } from 'react';
import { MarketingShell } from '@/features/marketing/components/MarketingShell';
import { MarketingHero } from '@/features/marketing/components/MarketingSections';
import { LeadForm } from '@/features/marketing/components/LeadForm';
import type { LeadFormValues } from '@/features/marketing/components/LeadForm';
import { marketingApi } from '@/services/marketingApi';
import type { ApiClientError } from '@/services/apiClient';

export default function ContactSalesPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const submitEnquiry = async (values: LeadFormValues) => {
    setBusy(true);
    setError(null);
    try {
      await marketingApi.captureLead({ ...values, source: 'WEBSITE' });
      setSubmitted(true);
    } catch (err) {
      setError((err as ApiClientError)?.message ?? 'The enquiry could not be sent. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <MarketingShell>
      <MarketingHero
        eyebrow="Contact sales"
        title="Talk to the team about your rollout"
        description="Tell us about your company and the process you want to automate. A specialist replies with a rollout plan, pricing for your scale and the security answers your team needs."
      />

      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8" aria-label="Sales enquiry">
        {submitted ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
            <h2 className="text-lg font-semibold text-emerald-900">Thanks — we have your enquiry</h2>
            <p className="mt-2 text-sm text-emerald-800">
              A solutions specialist will reach out shortly. In the meantime you can create a free
              workspace and try the engine with your own workflow.
            </p>
            <a
              href="/register"
              className="mt-4 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              Create a free workspace
            </a>
          </div>
        ) : (
          <>
            {error ? (
              <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            ) : null}
            <LeadForm submitLabel="Send enquiry" busy={busy} onSubmit={submitEnquiry} />
          </>
        )}
      </section>
    </MarketingShell>
  );
}
