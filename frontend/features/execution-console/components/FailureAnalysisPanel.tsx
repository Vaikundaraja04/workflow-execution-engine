'use client';

import * as React from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { hasPermission } from '@/types/permissions';
import { executionConsoleApi } from '@/services/executionConsoleApi';
import type { FailureAnalysisResult } from '@/features/execution-console/types/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Lock,
  RefreshCw,
  Copy,
  Check,
  Zap,
  HelpCircle,
  Sliders,
} from 'lucide-react';

interface FailureAnalysisPanelProps {
  executionId: string;
  workspaceId?: string;
  isFailed?: boolean;
}

export function FailureAnalysisPanel({
  executionId,
  workspaceId,
  isFailed = true,
}: FailureAnalysisPanelProps) {
  const { currentRole } = useWorkspaceStore();
  const canReadAnalysis = hasPermission(currentRole, 'AI_ANALYSIS_READ');

  const [analysis, setAnalysis] = React.useState<FailureAnalysisResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const fetchAnalysis = React.useCallback(async () => {
    if (!canReadAnalysis || !executionId) return;

    setLoading(true);
    setError(null);
    try {
      const data = await executionConsoleApi.getExecutionAnalysis(executionId, workspaceId);
      setAnalysis(data);
    } catch (err: any) {
      console.error('Failed to fetch AI failure analysis:', err);
      setError(
        err?.response?.data?.message ||
          err?.response?.data?.error?.message ||
          'Failed to generate AI failure analysis.'
      );
    } finally {
      setLoading(false);
    }
  }, [executionId, workspaceId, canReadAnalysis]);

  React.useEffect(() => {
    if (canReadAnalysis && isFailed) {
      fetchAnalysis();
    }
  }, [canReadAnalysis, isFailed, fetchAnalysis]);

  const handleCopyFix = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // If user lacks permission
  if (!canReadAnalysis) {
    return (
      <div className="bg-gradient-to-r from-purple-50/50 to-indigo-50/50 rounded-xl border border-purple-200/60 p-5 shadow-xs">
        <div className="flex items-center space-x-3 text-purple-900">
          <div className="p-2 rounded-lg bg-purple-100 text-purple-600">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-semibold">AI Root Cause Analysis (Restricted)</h4>
            <p className="text-xs text-purple-700/80 mt-0.5">
              Requires <code className="font-mono bg-purple-100/80 px-1 py-0.5 rounded text-[11px]">AI_ANALYSIS_READ</code> permission. Contact your workspace administrator to access AI insights.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-indigo-50/40 via-white to-purple-50/40 rounded-xl border border-indigo-200/80 p-5 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-indigo-100/80 pb-3">
        <div className="flex items-center space-x-2.5">
          <div className="p-1.5 rounded-lg bg-indigo-600 text-white shadow-xs">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-bold text-gray-900">AI Failure Diagnostics & Root Cause</h3>
              <Badge variant="secondary" size="sm" className="bg-purple-100 text-purple-700 border-purple-200">
                Claude AI
              </Badge>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Automated anomaly detection and resolution intelligence
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={fetchAnalysis}
          disabled={loading}
          className="text-xs h-8 bg-white hover:bg-indigo-50 border-indigo-200 text-indigo-700"
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Analyzing...' : 'Re-analyze'}
        </Button>
      </div>

      {/* Content states */}
      {loading && (
        <div className="py-8 flex flex-col items-center justify-center space-y-3">
          <div className="p-3 bg-indigo-100/50 rounded-full text-indigo-600 animate-pulse">
            <Sparkles className="w-6 h-6 animate-spin" />
          </div>
          <div className="text-center">
            <p className="text-xs font-semibold text-gray-800">Analyzing execution graph & log traces...</p>
            <p className="text-[11px] text-gray-500 mt-0.5">Inferring root cause and synthesizing fix recommendations</p>
          </div>
        </div>
      )}

      {error && !loading && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs flex items-start space-x-3">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-rose-900">Analysis Unavailable</p>
            <p className="mt-0.5 text-rose-700">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && analysis && (
        <div className="space-y-4">
          {/* Top Metrics Banner */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Confidence */}
            <div className="bg-white/90 rounded-lg border border-indigo-100 p-3 flex items-center justify-between shadow-2xs">
              <span className="text-xs text-gray-600 flex items-center gap-1.5 font-medium">
                <Zap className="w-3.5 h-3.5 text-amber-500" /> Diagnosis Confidence
              </span>
              <div className="flex items-center space-x-2">
                <div className="w-20 bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-indigo-600 h-2 rounded-full"
                    style={{ width: `${Math.round((analysis.confidence || 0.9) * 100)}%` }}
                  />
                </div>
                <span className="text-xs font-bold font-mono text-indigo-900">
                  {Math.round((analysis.confidence || 0.9) * 100)}%
                </span>
              </div>
            </div>

            {/* Affected Node */}
            <div className="bg-white/90 rounded-lg border border-indigo-100 p-3 flex items-center justify-between shadow-2xs">
              <span className="text-xs text-gray-600 flex items-center gap-1.5 font-medium">
                <Sliders className="w-3.5 h-3.5 text-indigo-500" /> Affected Node
              </span>
              <span className="text-xs font-mono font-bold text-gray-800 bg-gray-100 px-2 py-0.5 rounded">
                {analysis.affectedNode || 'Pipeline Orchestrator'}
              </span>
            </div>
          </div>

          {/* Root Cause Card */}
          <div className="bg-white rounded-lg border border-indigo-100/90 p-3.5 shadow-2xs space-y-1.5">
            <h4 className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-rose-500" /> Identified Root Cause
            </h4>
            <p className="text-xs text-gray-700 leading-relaxed font-sans">
              {analysis.rootCause}
            </p>
          </div>

          {/* Suggested Fix Card */}
          <div className="bg-white rounded-lg border border-indigo-100/90 p-3.5 shadow-2xs space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Recommended Resolution
              </h4>
              <button
                onClick={() => handleCopyFix(analysis.suggestedFix || (analysis as any).resolution || '')}
                className="flex items-center space-x-1 text-xs text-gray-500 hover:text-gray-800 bg-gray-50 border border-gray-200 rounded px-2 py-0.5 shadow-2xs transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600" />
                    <span className="text-emerald-600 text-[11px]">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span className="text-[11px]">Copy Fix</span>
                  </>
                )}
              </button>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-md p-2.5 text-xs text-gray-800 font-mono whitespace-pre-wrap leading-relaxed">
              {analysis.suggestedFix || (analysis as any).resolution}
            </div>
          </div>
        </div>
      )}

      {!loading && !error && !analysis && (
        <div className="text-center py-6 text-xs text-gray-500">
          Click "Re-analyze" to run AI diagnostics on this execution.
        </div>
      )}
    </div>
  );
}

export default FailureAnalysisPanel;
