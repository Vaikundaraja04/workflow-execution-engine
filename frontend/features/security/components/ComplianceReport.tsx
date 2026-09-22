'use client';

import React, { useState, useEffect } from 'react';
import {
  FileText,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  RefreshCw,
  Download,
  Loader2,
  List,
} from 'lucide-react';
import { securityApi } from '@/services/securityApi';
import type { ComplianceReportData, ComplianceFramework } from '@/types/security.types';

const FRAMEWORK_LABELS: Record<ComplianceFramework, string> = {
  SOC2: 'SOC2 Type II',
  GDPR: 'GDPR Article 30',
  ISO27001: 'ISO27001',
};

const SECTION_LABELS: Record<string, string> = {
  accessManagement: 'Access Management',
  changeManagement: 'Change Management',
  encryption: 'Encryption',
  incidentResponse: 'Incident Response',
  availability: 'Availability',
  confidentiality: 'Confidentiality',
  dataSubjectRights: 'Data Subject Rights',
  dataProtection: 'Data Protection',
  processingActivities: 'Processing Activities',
  retentionAndDeletion: 'Retention & Deletion',
  securityControls: 'Security Controls',
  assetManagement: 'Asset Management',
};

function humanize(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatKey(key: string): string {
  return SECTION_LABELS[key] ?? humanize(key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatPrimitive(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      return new Date(value).toLocaleString();
    }
    return value;
  }
  return String(value);
}

function MetricValue({ value }: { value: unknown }) {
  if (typeof value === 'boolean') {
    return value ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Compliant
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-800">
        <AlertTriangle className="h-3.5 w-3.5" />
        Attention
      </span>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-sm text-gray-500">None recorded</span>;
    }
    if (value.every((item) => !isPlainObject(item))) {
      return (
        <span className="text-sm text-gray-700">
          {value.map((item) => formatPrimitive(item)).join(', ')}
        </span>
      );
    }
    return (
      <div className="w-full space-y-2">
        {value.map((item, index) => (
          <div key={index} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            {isPlainObject(item) ? (
              <dl className="grid gap-1 text-xs">
                {Object.entries(item).map(([key, entryValue]) => (
                  <div key={key} className="flex justify-between gap-4">
                    <dt className="text-gray-500">{humanize(key)}</dt>
                    <dd className="text-right font-medium text-gray-800">
                      {formatPrimitive(entryValue)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <span className="text-xs text-gray-700">{formatPrimitive(item)}</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (isPlainObject(value)) {
    return <span className="font-mono text-xs text-gray-700">{JSON.stringify(value)}</span>;
  }

  return <span className="text-sm font-medium text-gray-900">{formatPrimitive(value)}</span>;
}

export const ComplianceReport: React.FC = () => {
  const [report, setReport] = useState<ComplianceReportData | null>(null);
  const [framework, setFramework] = useState<ComplianceFramework>('SOC2');
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await securityApi.getComplianceReport(framework);
      setReport(res);
      setGeneratedAt(new Date().toISOString());
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || err?.message || 'Failed to load the compliance report');
      setReport(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const res = await securityApi.getComplianceReport(framework);
      setReport(res);
      setGeneratedAt(new Date().toISOString());
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || err?.message || 'Failed to generate the compliance report');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExport = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compliance-report-${framework.toLowerCase()}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  useEffect(() => {
    void fetchReport();
  }, [framework]);

  const sections = report ? Object.entries(report) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <FileText className="h-7 w-7 text-indigo-600" />
            Compliance Evidence Center
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Generate SOC2 Type II, GDPR and ISO27001 evidence reports from workspace activity.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={framework}
            onChange={(e) => setFramework(e.target.value as ComplianceFramework)}
            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-900 focus:outline-none"
          >
            {(Object.keys(FRAMEWORK_LABELS) as ComplianceFramework[]).map((fw) => (
              <option key={fw} value={fw}>
                {FRAMEWORK_LABELS[fw]}
              </option>
            ))}
          </select>
          <button
            onClick={() => void handleGenerate()}
            disabled={isGenerating || isLoading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {isGenerating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {isGenerating ? 'Generating...' : 'Generate Report'}
          </button>
          {report && (
            <button
              onClick={handleExport}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
            >
              <Download className="h-3.5 w-3.5" />
              Export JSON
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
          <AlertTriangle className="h-5 w-5 text-rose-600" />
          <p className="font-medium">{error}</p>
        </div>
      )}

      {isLoading && !report && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading compliance evidence...
        </div>
      )}

      {report && sections.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xs">
          <div className="space-y-5 p-6">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900">
                <ShieldCheck className="h-5 w-5 text-indigo-600" />
                {FRAMEWORK_LABELS[framework]} Evidence Report
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Generated from live workspace evidence
                {generatedAt ? ' • ' + new Date(generatedAt).toLocaleString() : ''}
              </p>
            </div>

            {sections.map(([sectionKey, sectionValue]) => (
              <div key={sectionKey} className="overflow-hidden rounded-xl border border-gray-200">
                <div className="border-b border-gray-200 bg-gray-50 px-5 py-3">
                  <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900">
                    <List className="h-4 w-4 text-indigo-500" />
                    {formatKey(sectionKey)}
                  </h3>
                </div>
                <div className="p-5">
                  {isPlainObject(sectionValue) ? (
                    <div className="divide-y divide-gray-100">
                      {Object.entries(sectionValue).map(([metricKey, metricValue]) => (
                        <div
                          key={metricKey}
                          className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <span className="text-sm text-gray-500">{humanize(metricKey)}</span>
                          <MetricValue value={metricValue} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <MetricValue value={sectionValue} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!report && !isLoading && !error && (
        <div className="py-12 text-center">
          <ShieldCheck className="mx-auto mb-4 h-12 w-12 text-emerald-500" />
          <h3 className="mb-2 text-lg font-bold text-gray-900">No compliance report loaded</h3>
          <p className="text-sm text-gray-500">
            Select a framework and click "Generate Report" to build an evidence package.
          </p>
        </div>
      )}
    </div>
  );
};

export default ComplianceReport;
