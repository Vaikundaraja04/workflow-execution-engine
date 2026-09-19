'use client';

import React, { useState, useEffect } from 'react';
import {
  FileText,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  RefreshCw,
  Download,
  Search,
  Loader2,
  List,
  BarChart3,
  Globe,
} from 'lucide-react';
import { securityApi } from '@/services/securityApi';
import type { ComplianceReportData, ComplianceFramework } from '@/types/security.types';

export const ComplianceReport: React.FC = () => {
  const [report, setReport] = useState<ComplianceReportData | null>(null);
  const [framework, setFramework] = useState<ComplianceFramework>('SOC2');
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [availableFrameworks, setAvailableFrameworks] = useState<ComplianceFramework[]>(['SOC2', 'GDPR', 'ISO27001']);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await securityApi.getComplianceReport(framework);
      setReport(res);
    } catch (err: any) {
      setError(err.message || 'Failed to generate compliance report');
      setReport(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const res = await securityApi.generateComplianceReport(framework);
      setReport(res);
    } catch (err: any) {
      setError(err.message || 'Failed to generate compliance report');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExport = async (format: 'PDF' | 'JSON') => {
    if (!report) return;
    try {
      const res = await securityApi.exportComplianceReport(report.id, format);
      const blob = new Blob([res.data], { type: res.mimeType });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      setError(err.message || 'Failed to export report');
    }
  };

  useEffect(() => {
    fetchReport();
  }, [framework]);

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <FileText className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
            Compliance Evidence Center
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Automated SOC2 Type II, GDPR, and ISO27001 compliance reporting with evidence collection.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={framework}
            onChange={(e) => setFramework(e.target.value as ComplianceFramework)}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-hidden"
          >
            {availableFrameworks.map((fw) => (
              <option key={fw} value={fw}>
                {fw === 'SOC2' ? 'SOC2 Type II' : fw === 'GDPR' ? 'GDPR Article 30' : 'ISO27001'}
              </option>
            ))}
          </select>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-2xs transition"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              'Generate Report'
            )}
          </button>
          {report && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleExport('PDF')}
                className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5" />
                PDF
              </button>
              <button
                onClick={() => handleExport('JSON')}
                className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5" />
                JSON
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-xl border bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
          <div>
            <p className="font-medium">{error}</p>
          </div>
        </div>
      )}

      {/* Report Content */}
      {report && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xs overflow-hidden">
          <div className="p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-indigo-600" />
                {framework === 'SOC2' ? 'SOC2 Type II' : framework === 'GDPR' ? 'GDPR Article 30' : 'ISO27001'} Report
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Report ID: {report.id} • Generated: {new Date(report.generatedAt).toLocaleString()} •
                {report.status === 'COMPLETED' ? (
                  <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-400">
                    COMPLETED
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-400">
                    IN_PROGRESS
                  </span>
                )}
              </p>
            </div>

            {/* Evidence Sections */}
            <div className="space-y-5">
              {report.sections.map((section, idx) => (
                <div key={idx} className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                  <div className="bg-gray-50 dark:bg-gray-900/50 px-5 py-3 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                      <List className="w-4 h-4 text-indigo-500" />
                      {section.title}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {section.description}
                    </p>
                  </div>
                  <div className="p-4">
                    {section.controls.map((control, cdx) => (
                      <div key={cdx} className="flex items-start gap-4 mb-3 last:mb-0">
                        <div className="flex-shrink-0 mt-1">
                          {control.compliant ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-rose-600" />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-start justify-between">
                            <h4 className="text-sm font-medium text-gray-900 dark:text-white">
                              {control.id}: {control.title}
                            </h4>
                            <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                              control.compliant
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-400'
                                : 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-400'
                            }`}>
                              {control.compliant ? 'COMPLIANT' : 'NON_COMPLIANT'}
                            </span>
                          </div>
                          {control.description && (
                            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                              {control.description}
                            </p>
                          )}
                          {control.evidence && control.evidence.length > 0 && (
                            <div className="mt-2">
                              <p className="text-xs font-medium text-gray-800 dark:text-gray-200 mb-1">
                                Evidence:
                              </p>
                              <ul className="list-disc list-inside text-xs text-gray-700 dark:text-gray-300 space-y-1">
                                {control.evidence.map((ev, evdx) => (
                                  <li key={evdx}>{ev}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Summary */}
            <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-indigo-600" />
                Executive Summary
              </h3>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {report.summary}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Placeholder when no report */}
      {!report && !isLoading && !error && (
        <div className="text-center py-12">
          <ShieldCheck className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
            No compliance report generated
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Select a compliance framework and click "Generate Report" to create an automated compliance evidence package.
          </p>
        </div>
      )}
    </div>
  );
};
export default ComplianceReport;