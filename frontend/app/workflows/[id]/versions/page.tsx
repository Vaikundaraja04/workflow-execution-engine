'use client';

import * as React from 'react';
import { useParams, notFound } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ArrowLeft, History, GitCompare, Calendar, CheckCircle, Clock } from 'lucide-react';
import Link from 'next/link';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { hasPermission } from '@/types/permissions';
import { workflowApi } from '@/services/workflowApi';
import type { WorkflowVersionView, VersionComparison } from '@/types/workflow';

export default function WorkflowVersionsPage() {
  const params = useParams<{ id: string }>();
  const workflowId = params?.id;

  if (!workflowId) {
    notFound();
  }

  const [versions, setVersions] = useState<WorkflowVersionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comparing, setComparing] = useState<{
    versionA: number | null;
    versionB: number | null;
    result: VersionComparison | null;
    loading: boolean;
    error: string | null;
  }>({
    versionA: null,
    versionB: null,
    result: null,
    loading: false,
    error: null,
  });

  const { currentRole } = useWorkspaceStore();

  const canViewVersions =
    hasPermission(currentRole, 'WORKFLOW_READ') ||
    hasPermission(currentRole, 'WORKFLOW_UPDATE') ||
    hasPermission(currentRole, 'WORKFLOW_CREATE');

  useEffect(() => {
    if (!workflowId) return;

    let isMounted = true;

    const loadVersions = async () => {
      try {
        if (!canViewVersions) {
          if (isMounted) notFound();
          return;
        }

        setLoading(true);
        setError(null);
        const data = await workflowApi.listVersions(workflowId);
        if (isMounted) {
          setVersions(data);
          setLoading(false);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || 'Failed to load versions');
          setLoading(false);
        }
      }
    };

    loadVersions();

    return () => {
      isMounted = false;
    };
  }, [workflowId, canViewVersions]);

  const handleCompare = async () => {
    if (
      comparing.versionA === null ||
      comparing.versionB === null ||
      comparing.versionA === comparing.versionB
    ) {
      return;
    }

    setComparing((prev) => ({
      ...prev,
      loading: true,
      result: null,
      error: null,
    }));

    try {
      const result = await workflowApi.compareVersions(
        workflowId,
        comparing.versionA,
        comparing.versionB
      );
      setComparing((prev) => ({
        ...prev,
        result,
        loading: false,
        error: null,
      }));
    } catch (err: any) {
      setComparing((prev) => ({
        ...prev,
        loading: false,
        result: null,
        error: err?.response?.data?.message || err.message || 'Failed to compare versions',
      }));
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center px-4 bg-gray-50">
        <div className="bg-rose-50 text-rose-700 p-4 rounded-lg border border-rose-200 max-w-md w-full">
          <p className="font-semibold text-sm">Error loading versions:</p>
          <p className="mt-1 text-xs">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50 overflow-hidden">
      {/* Header */}
      <header className="h-14 border-b border-gray-200 bg-white px-4 flex items-center justify-between shrink-0 select-none z-10">
        <div className="flex items-center space-x-3">
          <Link
            href={`/workflows/${workflowId}/edit`}
            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-900 transition-colors"
            title="Back to Workflow Editor"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>

          <div className="flex items-center space-x-2">
            <History className="h-4 w-4 text-primary" />
            <h1 className="text-sm font-semibold text-gray-900">
              Workflow Version History
            </h1>
          </div>
        </div>

        {/* Clear Comparison Button */}
        {(comparing.versionA !== null || comparing.versionB !== null || comparing.result) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setComparing({
                versionA: null,
                versionB: null,
                result: null,
                loading: false,
                error: null,
              });
            }}
            className="text-xs h-8"
          >
            Clear Comparison
          </Button>
        )}
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6 max-w-5xl w-full mx-auto space-y-6">
        {/* Comparison Diff Box */}
        {comparing.error && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs">
            <span className="font-semibold">Comparison failed: </span>
            {comparing.error}
          </div>
        )}

        {comparing.result && (
          <div className="p-5 bg-white rounded-xl border border-gray-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center space-x-2">
                <GitCompare className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-gray-900">
                  Comparison: Version {comparing.result.from.versionNumber} vs Version {comparing.result.to.versionNumber}
                </h2>
              </div>
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                  comparing.result.identical
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}
              >
                {comparing.result.identical ? 'Identical Definitions' : 'Differences Detected'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-lg">
                <p className="text-emerald-700 font-medium">Added Nodes</p>
                <p className="text-lg font-bold text-emerald-900 mt-0.5">
                  {comparing.result.nodes.added.length}
                </p>
              </div>
              <div className="p-3 bg-rose-50/60 border border-rose-200 rounded-lg">
                <p className="text-rose-700 font-medium">Removed Nodes</p>
                <p className="text-lg font-bold text-rose-900 mt-0.5">
                  {comparing.result.nodes.removed.length}
                </p>
              </div>
              <div className="p-3 bg-amber-50/60 border border-amber-200 rounded-lg">
                <p className="text-amber-700 font-medium">Modified Nodes</p>
                <p className="text-lg font-bold text-amber-900 mt-0.5">
                  {comparing.result.nodes.changed.length}
                </p>
              </div>
              <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-lg">
                <p className="text-blue-700 font-medium">Changed Edges</p>
                <p className="text-lg font-bold text-blue-900 mt-0.5">
                  {comparing.result.edges.added.length + comparing.result.edges.removed.length}
                </p>
              </div>
            </div>

            {/* Changed Nodes Detail */}
            {comparing.result.nodes.changed.length > 0 && (
              <div className="mt-3 space-y-2 border-t pt-3">
                <h4 className="text-xs font-semibold text-gray-800">Node Modifications</h4>
                <div className="space-y-1.5">
                  {comparing.result.nodes.changed.map((change) => (
                    <div key={change.id} className="p-2.5 bg-gray-50 rounded-lg border border-gray-200 text-xs">
                      <p className="font-semibold text-gray-800">Node: {change.id}</p>
                      <ul className="mt-1 list-disc list-inside space-y-0.5 text-gray-600 text-[11px]">
                        {change.fields.map((f, i) => (
                          <li key={i}>
                            <span className="font-medium text-gray-700">{f.field}:</span>{' '}
                            <span className="text-rose-600 line-through mr-1">{JSON.stringify(f.from)}</span>
                            <span className="text-emerald-600">→ {JSON.stringify(f.to)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Versions List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">
              Published Versions ({versions.length})
            </h2>
            <span className="text-xs text-gray-500">
              Select two versions to compare definitions
            </span>
          </div>

          {versions.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-200">
              <History className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              <p className="text-xs font-medium text-gray-600">No published versions yet</p>
              <p className="text-[11px] text-gray-400 mt-1">
                Publish this workflow to create immutable version snapshots.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {versions.map((ver) => {
                const isSelectedA = comparing.versionA === ver.versionNumber;
                const isSelectedB = comparing.versionB === ver.versionNumber;
                const isSelected = isSelectedA || isSelectedB;

                return (
                  <div
                    key={ver.id || ver.versionNumber}
                    onClick={() => {
                      if (comparing.versionA === null) {
                        setComparing((prev) => ({ ...prev, versionA: ver.versionNumber }));
                      } else if (comparing.versionB === null && comparing.versionA !== ver.versionNumber) {
                        setComparing((prev) => ({ ...prev, versionB: ver.versionNumber }));
                      } else {
                        setComparing((prev) => ({
                          ...prev,
                          versionA: ver.versionNumber,
                          versionB: null,
                          result: null,
                        }));
                      }
                    }}
                    className={`p-4 rounded-xl border bg-white cursor-pointer transition-all hover:border-primary/60 hover:shadow-xs ${
                      isSelected
                        ? 'border-primary ring-1 ring-primary bg-primary/5'
                        : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200">
                          v{ver.versionNumber}
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="text-xs font-semibold text-gray-900">
                              Version {ver.versionNumber}
                            </span>
                            <span
                              className={`text-[10px] px-2 py-0.2 rounded-full font-medium ${
                                ver.status === 'PUBLISHED'
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {ver.status}
                            </span>
                            {isSelectedA && (
                              <span className="text-[10px] bg-primary text-white font-bold px-1.5 py-0.2 rounded">
                                Base (A)
                              </span>
                            )}
                            {isSelectedB && (
                              <span className="text-[10px] bg-blue-600 text-white font-bold px-1.5 py-0.2 rounded">
                                Target (B)
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-600 mt-0.5">
                            {ver.changeSummary || 'No change summary recorded'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-3 text-xs text-gray-500">
                        <div className="flex items-center space-x-1">
                          <Calendar className="h-3.5 w-3.5 text-gray-400" />
                          <span>{new Date(ver.createdAt).toLocaleDateString()}</span>
                        </div>
                        <span className="font-mono text-[10px] bg-gray-50 border px-1.5 py-0.5 rounded text-gray-500">
                          {ver.definitionHash ? ver.definitionHash.slice(0, 8) : 'hash'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Compare Control Bar at bottom */}
        <div className="p-4 bg-white rounded-xl border border-gray-200 flex items-center justify-between">
          <div className="flex items-center space-x-3 text-xs">
            <span className="text-gray-500">Version A:</span>
            <span className="font-semibold text-gray-800">
              {comparing.versionA ? `v${comparing.versionA}` : 'None'}
            </span>
            <span className="text-gray-400">↔</span>
            <span className="text-gray-500">Version B:</span>
            <span className="font-semibold text-gray-800">
              {comparing.versionB ? `v${comparing.versionB}` : 'None'}
            </span>
          </div>

          <Button
            size="sm"
            onClick={handleCompare}
            disabled={
              comparing.loading ||
              comparing.versionA === null ||
              comparing.versionB === null ||
              comparing.versionA === comparing.versionB
            }
            className="text-xs h-8"
          >
            <GitCompare className="h-3.5 w-3.5 mr-1" />
            <span>{comparing.loading ? 'Comparing...' : 'Compare Selected'}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
