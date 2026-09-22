'use client';

import * as React from 'react';
import { useState } from 'react';
import type { LeadCaptureInput } from '@/services/marketingApi';

const INDUSTRIES = [
  'Technology',
  'Financial Services',
  'Healthcare',
  'Retail',
  'Manufacturing',
  'Logistics',
  'Professional Services',
  'Telecommunications',
  'Public Sector',
  'Other',
];

const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-1000', '1000+'];
const INTERESTS = ['STARTER', 'BUSINESS', 'ENTERPRISE', 'NOT_SURE'];

export interface LeadFormValues extends LeadCaptureInput {}

export function LeadForm({
  submitLabel,
  busy,
  onSubmit,
  includeMessage = true,
}: {
  submitLabel: string;
  busy: boolean;
  onSubmit: (values: LeadFormValues) => void;
  includeMessage?: boolean;
}) {
  const [values, setValues] = useState({
    company: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    industry: 'Technology',
    companySize: '11-50',
    interest: 'NOT_SURE',
    message: '',
  });

  const update = (field: keyof typeof values) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload: LeadFormValues = {
      company: values.company,
      contactName: values.contactName,
      contactEmail: values.contactEmail,
      industry: values.industry,
      companySize: values.companySize,
      interest: values.interest,
    };
    if (values.contactPhone.trim()) payload.contactPhone = values.contactPhone.trim();
    if (includeMessage && values.message.trim()) payload.message = values.message.trim();
    onSubmit(payload);
  };

  const inputClass =
    'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm font-medium text-slate-700">
        Company
        <input required value={values.company} onChange={update('company')} className={inputClass} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Your name
        <input required value={values.contactName} onChange={update('contactName')} className={inputClass} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Work email
        <input
          required
          type="email"
          value={values.contactEmail}
          onChange={update('contactEmail')}
          className={inputClass}
        />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Phone (optional)
        <input value={values.contactPhone} onChange={update('contactPhone')} className={inputClass} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Industry
        <select value={values.industry} onChange={update('industry')} className={inputClass}>
          {INDUSTRIES.map((industry) => (
            <option key={industry} value={industry}>
              {industry}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Company size
        <select value={values.companySize} onChange={update('companySize')} className={inputClass}>
          {COMPANY_SIZES.map((size) => (
            <option key={size} value={size}>
              {size} people
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
        Plan interest
        <select value={values.interest} onChange={update('interest')} className={inputClass}>
          {INTERESTS.map((interest) => (
            <option key={interest} value={interest}>
              {interest.replace('_', ' ')}
            </option>
          ))}
        </select>
      </label>
      {includeMessage ? (
        <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
          What are you automating?
          <textarea
            rows={4}
            value={values.message}
            onChange={update('message')}
            className={inputClass}
          />
        </label>
      ) : null}
      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Submitting...' : submitLabel}
        </button>
      </div>
    </form>
  );
}

export default LeadForm;
