'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { ConfidenceBadge } from '../components/ConfidenceBadge';
import { AIErrorState } from '../components/AIErrorState';
import { useExecutionAnalysis } from '../hooks/useExecutionAnalysis';
import {
  Sparkles,
  RefreshCw,
  Copy,
  Check,
  AlertCircle,
  Target,
  Waves,
  CheckCircle2,
  Lock,
} from 'lucide-react';

interface ExecutionAIAnalysisProps {
  executionId: string;
  autoAnalyze?: boolean;
  className?: string;
}

export function ExecutionAIAnalysis({
  executionId,
  autoAnalyze = true,
  className,
}: ExecutionAIAnalysisProps) {
  const { result, error, analyze, canReadAnalysis, isAnalyzing } = useExecutionAnalysis(executionId);
  const [copied, setCopied] = React.useState(false);

  const runAnalysis = React.useCallback(async () => {
    await analyze();
  }, [analyze]);

  React.useEffect(() => {
    if (autoAnalyze && canReadAnalysis && !result) {
      runAnalysis();
    }
  }, [autoAnalyze, canReadAnalysis, result, runAnalysis]);

  const handleCopyFix = (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };
  if (!canReadAnalysis) {
    return (
      <AIErrorState
        variant="permission"
        title="AI diagnostics restricted"
        message="Failure analysis is limited to roles with AI read access."
        hint={
          <span>
            Requires <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px]">AI_ANALYSIS_READ</code>{' '}
            permission.
          </span>
        }
        className={className}
      />
    );
  }

  return (
    <div
      data-testid="execution-ai-analysis"
      className={cn(
        'space-y-4 rounded-xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50/40 via-white to-purple-50/40 p-5 shadow-sm',
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-indigo-100 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">AI Failure Analysis</h3>
            <p className="text-[11px] text-gray-500">Root cause, error pattern and recommended fix</p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={runAnalysis}
          disabled={isAnalyzing || (!result && !error && autoAnalyze)}
          className="h-8 border-indigo-200 bg-white text-xs text-indigo-700 hover:bg-indigo-50"
        >
          <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', isAnalyzing && 'animate-spin')} />
          {isAnalyzing ? 'Analyzing...' : result ? 'Re-analyze' : 'Analyze'}
        </Button>
      </div>

      {!result && !error && (
        <p className="flex items-center gap-2 py-6 text-center text-xs text-gray-500">
          <Lock className="h-3.5 w-3.5 text-gray-400" />
          Running AI diagnostics on this execution...
        </p>
      )}

      {error && <AIErrorState message={error} onRetry={runAnalysis} retryLabel="Retry analysis" />}

      {result && !error && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ConfidenceBadge confidence={result.confidence} showBar />
            <span className="text-[11px] text-gray-500">
              Affected execution: <code className="font-mono text-gray-700">{executionId}</code>
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <AnalysisBlock
              icon={<AlertCircle className="h-3.5 w-3.5 text-rose-500" />}
              title="Root Cause"
              testId="ai-root-cause"
            >
              {result.rootCause}
            </AnalysisBlock>

            <AnalysisBlock
              icon={<Target className="h-3.5 w-3.5 text-indigo-500" />}
              title="Affected Nodes"
              testId="ai-affected-nodes"
            >
              {result.affectedNode ? (
                <span className="rounded-md bg-gray-100 px-2 py-1 font-mono text-[11px] text-gray-700">
                  {result.affectedNode}
                </span>
              ) : (
                <span className="text-gray-500">No specific node - execution level failure</span>
              )}
            </AnalysisBlock>
          </div>

          <AnalysisBlock
            icon={<Waves className="h-3.5 w-3.5 text-amber-500" />}
            title="Error Pattern"
            testId="ai-error-pattern"
          >
            {result.summary}
          </AnalysisBlock>

          <div className="rounded-lg border border-indigo-100 bg-white p-3.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <h4 className="flex items-center gap-1.5 text-xs font-bold text-gray-900">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                Recommended Fix
              </h4>
              <button
                type="button"
                onClick={() => handleCopyFix(result.suggestedFix)}
                className="flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-500 transition-colors hover:text-gray-800"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-600" />
                    <span className="text-[11px] text-emerald-600">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span className="text-[11px]">Copy Fix</span>
                  </>
                )}
              </button>
            </div>
            <p className="mt-2 whitespace-pre-wrap rounded-md border border-slate-200/80 bg-slate-50 p-2.5 font-mono text-[11px] leading-relaxed text-gray-800">
              {result.suggestedFix}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function AnalysisBlock({
  icon,
  title,
  testId,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-indigo-100/90 bg-white p-3.5 shadow-2xs" data-testid={testId}>
      <h4 className="flex items-center gap-1.5 text-xs font-bold text-gray-900">
        {icon}
        {title}
      </h4>
      <div className="mt-1.5 text-xs leading-relaxed text-gray-700">{children}</div>
    </div>
  );
}

export default ExecutionAIAnalysis;
