'use client';

import * as React from 'react';
import { Bell, Activity, Clock, Zap, CheckCircle2, X, Trash2, Edit3 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

export interface SelfHealingIncident {
  id: string;
  workflowId: string;
  workflowName: string;
  executionId: string;
  errorType: string;
  errorMessage: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'detected' | 'healing' | 'resolved' | 'failed';
  detectedAt: string;
  resolvedAt?: string;
  healingAction?: string;
  policyApplied?: string;
  isManualApprovalRequired: boolean;
}

interface SelfHealingIncidentsTableProps {
  incidents: SelfHealingIncident[];
  onHealManually?: (incidentId: string) => void;
  onViewDetails?: (incidentId: string) => void;
  onDelete?: (incidentId: string) => void;
  className?: string;
}

export function SelfHealingIncidentsTable({
  incidents,
  onHealManually,
  onViewDetails,
  onDelete,
  className,
}: SelfHealingIncidentsTableProps) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [healAction, setHealAction] = React.useState('');

  const handleHealManually = (incidentId: string) => {
    if (onHealManually) onHealManually(incidentId);
  };

  return (
    <div className={cn('bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl', className)}>
      <div className="flex items-center justify-between px-5 py-4 bg-slate-950 border-b border-slate-800">
        <div className="flex items-center space-x-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-xs">
            <Bell className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
              Self-Healing Incidents
              <Badge variant="default" size="sm" className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-[10px]">
                Active
              </Badge>
            </h2>
            <p className="text-[11px] text-slate-400">
              Autonomous remediation and policy-driven incident response
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            // Trigger manual healing for selected incidents
          }}
          className="h-9 px-3.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs flex items-center gap-2"
        >
          <Zap className="w-3.5 h-3.5" />
          Heal Selected
        </Button>
      </div>

      <div className="overflow-y-auto">
        {incidents.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Activity className="w-10 h-10 mx-auto mb-4 text-slate-600 opacity-60" />
            <h3 className="text-xs font-semibold text-slate-400">No incidents detected</h3>
            <p className="text-[11px] text-slate-500 mt-2">
              All workflows are operating within normal parameters.
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-[11px] text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4 font-semibold">Workflow</th>
                <th className="py-3 px-4 font-semibold">Error</th>
                <th className="py-3 px-4 font-semibold">Severity</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold">Detected</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {incidents.map((incident) => {
                const isEditing = editingId === incident.id;
                const severityColor =
                  incident.severity === 'critical'
                    ? 'text-rose-400'
                    : incident.severity === 'high'
                      ? 'text-amber-300'
                      : incident.severity === 'medium'
                        ? 'text-yellow-300'
                        : 'text-emerald-300';
                const statusColor =
                  incident.status === 'resolved'
                    ? 'text-emerald-400'
                    : incident.status === 'failed'
                      ? 'text-rose-400'
                      : incident.status === 'healing'
                        ? 'text-amber-300'
                        : 'text-blue-300';

                return (
                  <tr key={incident.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-4 px-4 font-medium text-slate-200 flex items-center gap-2">
                      <Activity className="w-4 h-4 text-indigo-300" />
                      <div className="flex flex-col">
                        <span className="text-[12px]">{incident.workflowName}</span>
                        <span className="text-[10px] text-slate-500">{incident.workflowId.substring(0, 8)}...</span>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex flex-col">
                        <span className="text-[12px] font-mono">{incident.errorType}</span>
                        {incident.errorMessage && (
                          <p className="text-[10px] text-slate-500 line-clause-2 max-w-[200px]">
                            {incident.errorMessage}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <span className={cn('text-[12px] font-semibold', severityColor)}>{incident.severity.toUpperCase()}</span>
                    </td>
                    <td className="py-4 px-4">
                      <span className={cn('text-[12px] font-semibold', statusColor)}>
                        {incident.status.toUpperCase()}
                      </span>
                      {incident.isManualApprovalRequired && (
                        <span className="ml-2 h-2 w-2 rounded-full bg-amber-400 animate-pulse" title="Requires manual approval" />
                      )}
                    </td>
                    <td className="py-4 px-4 text-slate-400">
                      <Clock className="w-3.5 h-3.5 mr-1" />
                      <span>{new Date(incident.detectedAt).toLocaleString()}</span>
                    </td>
                    <td className="py-4 px-4 text-right">
                      <div className="flex items-center justify-end gap-2 font-sans">
                        {onViewDetails && (
                          <button
                            onClick={() => onViewDetails(incident.id)}
                            title="View details"
                            className="p-1 text-slate-400 hover:text-indigo-300 hover:bg-slate-800 rounded cursor-pointer transition-colors"
                          >
                            <Activity className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {!incident.isManualApprovalRequired && onHealManually && (
                          <button
                            onClick={() => handleHealManually(incident.id)}
                            title="Heal manually"
                            className="p-1 text-slate-400 hover:text-indigo-300 hover:bg-slate-800 rounded cursor-pointer transition-colors"
                          >
                            <Zap className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {onDelete && (
                          <button
                            onClick={() => onDelete(incident.id)}
                            title="Delete record"
                            className="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded cursor-pointer transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Manual Heal Modal Trigger */}
      {editingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 bg-slate-950 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <Zap className="w-4 h-4 text-indigo-400" />
                <h3 className="text-xs font-bold text-white">Manual Healing Action</h3>
              </div>
              <button
                onClick={() => setEditingId(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4">
              <form className="space-y-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Healing Action Description</label>
                  <textarea
                    value={healAction}
                    onChange={(e) => setHealAction(e.target.value)}
                    placeholder="Describe the manual healing action to apply..."
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-xs text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none h-[80px]"
                  />
                </div>
                <div className="flex items-center justify-end gap-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditingId(null)}
                    className="h-8 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => {
                      // Submit manual healing action
                      setEditingId(null);
                    }}
                    className="h-8 px-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs"
                  >
                    Apply Healing
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SelfHealingIncidentsTable;