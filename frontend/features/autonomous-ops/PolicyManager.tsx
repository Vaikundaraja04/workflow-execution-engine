'use client';

import * as React from 'react';
import { ShieldCheck, Sliders, List, Activity, Clock, Zap, Trash2, Edit3, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

export interface SelfHealingPolicy {
  id: string;
  name: string;
  description: string;
  triggerEvent: string;
  conditions: {
    errorType?: string[];
    severity?: ('low' | 'medium' | 'high' | 'critical')[];
    workflowIds?: string[];
    timeWindow?: { start: string; end: string }; // HH:MM format
  };
  actions: Array<{
    type: 'notify' | 'auto_heal' | 'scale_resources' | 'rollback' | 'webhook';
    configuration: Record<string, any>;
  }>;
  isEnabled: boolean;
  priority: number; // 1-100, higher is higher priority
  lastTriggered?: string;
  triggerCount: number;
  successRate: number; // 0-100
}

interface PolicyManagerProps {
  policies: SelfHealingPolicy[];
  onCreatePolicy: (policy: Omit<SelfHealingPolicy, 'id' | 'lastTriggered' | 'triggerCount' | 'successRate'>) => void;
  onUpdatePolicy: (id: string, updates: Partial<SelfHealingPolicy>) => void;
  onDeletePolicy: (id: string) => void;
  onTogglePolicy: (id: string) => void;
  className?: string;
}

export function PolicyManager({
  policies,
  onCreatePolicy,
  onUpdatePolicy,
  onDeletePolicy,
  onTogglePolicy,
  className,
}: PolicyManagerProps) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [policyForm, setPolicyForm] = React.useState<Omit<SelfHealingPolicy, 'id' | 'lastTriggered' | 'triggerCount' | 'successRate'>>({
    name: '',
    description: '',
    triggerEvent: '',
    conditions: {
      errorType: [],
      severity: [],
      workflowIds: [],
      timeWindow: { start: '00:00', end: '23:59' },
    },
    actions: [],
    isEnabled: true,
    priority: 50,
  });
  const [activeTab, setActiveTab] = React.useState<'policies' | 'create'>('policies');

  const handleSavePolicy = () => {
    if (editingId) {
      onUpdatePolicy(editingId, policyForm);
      setEditingId(null);
    } else {
      onCreatePolicy(policyForm);
    }
    // Reset form
    setPolicyForm({
      name: '',
      description: '',
      triggerEvent: '',
      conditions: {
        errorType: [],
        severity: [],
        workflowIds: [],
        timeWindow: { start: '00:00', end: '23:59' },
      },
      actions: [],
      isEnabled: true,
      priority: 50,
    });
    setActiveTab('policies');
  };

  const handleEditPolicy = (policy: SelfHealingPolicy) => {
    setEditingId(policy.id);
    setPolicyForm({
      name: policy.name,
      description: policy.description,
      triggerEvent: policy.triggerEvent,
      conditions: {
        errorType: policy.conditions.errorType || [],
        severity: policy.conditions.severity || [],
        workflowIds: policy.conditions.workflowIds || [],
        timeWindow: policy.conditions.timeWindow || { start: '00:00', end: '23:59' },
      },
      actions: policy.actions || [],
      isEnabled: policy.isEnabled,
      priority: policy.priority,
    });
    setActiveTab('create');
  };

  return (
    <div className={cn('bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl', className)}>
      <div className="flex items-center justify-between px-5 py-4 bg-slate-950 border-b border-slate-800">
        <div className="flex items-center space-x-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-xs">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
              Policy Manager
              <Badge variant="default" size="sm" className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-[10px]">
                Active Policies: {policies.filter(p => p.isEnabled).length}
              </Badge>
            </h2>
            <p className="text-[11px] text-slate-400">
              Define and manage self-healing policies for automated incident response
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setEditingId(null);
            setPolicyForm({
              name: '',
              description: '',
              triggerEvent: '',
              conditions: {
                errorType: [],
                severity: [],
                workflowIds: [],
                timeWindow: { start: '00:00', end: '23:59' },
              },
              actions: [],
              isEnabled: true,
              priority: 50,
            });
            setActiveTab('create');
          }}
          className="h-9 px-3.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs flex items-center gap-2"
        >
          <Sliders className="w-3.5 h-3.5" />
          New Policy
        </Button>
      </div>

      {activeTab === 'create' ? (
        <div className="p-6">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 mb-4">
            <Activity className="w-3.5 h-3.5 text-indigo-400" />
            {editingId ? 'Edit Policy' : 'Create New Policy'}
          </h3>
          <form onSubmit={(e) => {
            e.preventDefault();
            handleSavePolicy();
          }} className="space-y-4">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Policy Name</label>
              <input
                value={policyForm.name}
                onChange={(e) => setPolicyForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Enter policy name..."
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-xs text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Description</label>
              <textarea
                value={policyForm.description}
                onChange={(e) => setPolicyForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Describe when this policy should trigger and what actions to take..."
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-xs text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none h-[80px]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Trigger Event</label>
              <select
                value={policyForm.triggerEvent}
                onChange={(e) => setPolicyForm(prev => ({ ...prev, triggerEvent: e.target.value }))}
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-xs text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">Select trigger event...</option>
                <option value="workflow_failure">Workflow Execution Failure</option>
                <option value="sla_breach">SLA Breach Predicted</option>
                <option value="resource_exhaustion">Resource Exhaustion (Memory/CPU)</option>
                <option value="error_rate_surge">Error Rate Surge</option>
                <option value="queue_depth_critical">Critical Queue Depth</option>
                <option value="manual">Manual Trigger Only</option>
              </select>
            </div>
            <div className="border-t border-slate-800/50 pt-4">
              <h4 className="text-[11px] font-semibold text-slate-300 mb-2">Conditions</h4>
              <div className="space-y-2">
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">Error Types</label>
                  <div className="flex flex-wrap gap-2">
                    {['timeout', 'validation_error', 'external_service_failure', 'data_ corruption', 'permission_denied'].map((type) => (
                      <label key={type} className="flex items-center gap-1 text-[10px]">
                        <input
                          type="checkbox"
                          checked={policyForm.conditions.errorType?.includes(type) || false}
                          onChange={(e) => {
                            setPolicyForm(prev => ({
                              ...prev,
                              conditions: {
                                ...prev.conditions,
                                errorType: e.target.checked
                                  ? [...(prev.conditions.errorType || []), type]
                                  : (prev.conditions.errorType || []).filter(t => t !== type),
                              },
                            }));
                          }}
                          className="h-3.5 w-3.5 text-indigo-600 border-indigo-500 rounded"
                        />
                        <span>{type}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">Severity Levels</label>
                  <div className="flex flex-wrap gap-2">
                    {['low', 'medium', 'high', 'critical'].map((sev) => (
                      <label key={sev} className="flex items-center gap-1 text-[10px]">
                        <input
                          type="checkbox"
                          checked={policyForm.conditions.severity?.includes(sev as any) || false}
                          onChange={(e) => {
                            setPolicyForm(prev => ({
                              ...prev,
                              conditions: {
                                ...prev.conditions,
                                severity: e.target.checked
                                  ? [...(prev.conditions.severity || []), sev as any]
                                  : (prev.conditions.severity || []).filter(s => s !== sev),
                              },
                            }));
                          }}
                          className="h-3.5 w-3.5 text-indigo-600 border-indigo-500 rounded"
                        />
                        <span className={cn(
                          'text-[10px] font-medium',
                          sev === 'critical' ? 'text-rose-400' :
                            sev === 'high' ? 'text-amber-300' :
                            sev === 'medium' ? 'text-yellow-300' : 'text-emerald-300'
                        )}>
                          {sev.toUpperCase()}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">Workflow IDs (optional)</label>
                  <input
                    value={policyForm.conditions.workflowIds?.join(', ') || ''}
                    onChange={(e) => {
                      const ids = e.target.value
                        .split(',')
                        .map((id) => id.trim())
                        .filter((id) => id.length > 0);
                      setPolicyForm(prev => ({
                        ...prev,
                        conditions: {
                          ...prev.conditions,
                          workflowIds: ids,
                        },
                      }));
                    }}
                    placeholder="wf_123, wf_456 (leave empty for all workflows)"
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-xs text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Time Window</label>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={policyForm.conditions.timeWindow?.start ?? ''}
                      onChange={(e) => setPolicyForm(prev => ({
                        ...prev,
                        conditions: {
                          ...prev.conditions,
                          timeWindow: {
                            ...(prev.conditions.timeWindow ?? { start: '00:00', end: '23:59' }),
                            start: e.target.value.padStart(5, '0').slice(0, 5),
                          },
                        },
                      }))}
                      placeholder="HH:MM"
                      className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-center text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                    <span className="text-xs text-slate-400">to</span>
                    <input
                      value={policyForm.conditions.timeWindow?.end ?? ''}
                      onChange={(e) => setPolicyForm(prev => ({
                        ...prev,
                        conditions: {
                          ...prev.conditions,
                          timeWindow: {
                            ...(prev.conditions.timeWindow ?? { start: '00:00', end: '23:59' }),
                            end: e.target.value.padStart(5, '0').slice(0, 5),
                          },
                        },
                      }))}
                      placeholder="HH:MM"
                      className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-center text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="border-t border-slate-800/50 pt-4">
              <h4 className="text-[11px] font-semibold text-slate-300 mb-2">Actions</h4>
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <label className="text-[10px] text-slate-400 flex-1">Action Type</label>
                  <label className="text-[10px] text-slate-400">Enabled</label>
                </div>
                {([
                  { type: 'notify', label: 'Send Notification' },
                  { type: 'auto_heal', label: 'Auto-Heal Workflow' },
                  { type: 'scale_resources', label: 'Scale Execution Resources' },
                  { type: 'rollback', label: 'Rollback to Previous Version' },
                  { type: 'webhook', label: 'Trigger Webhook' },
                ] as const).map((action, index) => (
                  <div key={index} className="flex items-center gap-3 py-2 border-t border-slate-800/50 pt-2">
                    <span className="text-[10px] text-slate-300 flex-1">{action.label}</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={policyForm.actions.some(a => a.type === action.type)}
                        onChange={(e) => {
                          setPolicyForm(prev => ({
                            ...prev,
                            actions: e.target.checked
                              ? [
                                  ...prev.actions.filter(a => a.type !== action.type),
                                  { type: action.type, configuration: {} },
                                ]
                              : prev.actions.filter(a => a.type !== action.type),
                          }));
                        }}
                        className="h-3.5 w-3.5 text-indigo-600 border-indigo-500 rounded"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t border-slate-800/50 pt-4">
              <h4 className="text-[11px] font-semibold text-slate-300 mb-2">Settings</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Enabled</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={policyForm.isEnabled}
                      onChange={(e) => setPolicyForm(prev => ({ ...prev, isEnabled: e.target.checked }))}
                      className="h-3.5 w-3.5 text-indigo-600 border-indigo-500 rounded"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Priority (1-100)</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={policyForm.priority}
                    onChange={(e) => setPolicyForm(prev => ({ ...prev, priority: Math.max(1, Math.min(100, Number(e.target.value))) }))}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-xs text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>
          </form>
          <div className="flex items-center justify-end gap-3 pt-4">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditingId(null);
                setPolicyForm({
                  name: '',
                  description: '',
                  triggerEvent: '',
                  conditions: {
                    errorType: [],
                    severity: [],
                    workflowIds: [],
                    timeWindow: { start: '00:00', end: '23:59' },
                  },
                  actions: [],
                  isEnabled: true,
                  priority: 50,
                });
                setActiveTab('policies');
              }}
              className="h-8 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={handleSavePolicy}
              className="h-8 px-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs"
            >
              {editingId ? 'Update Policy' : 'Create Policy'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="overflow-y-auto">
          {policies.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <List className="w-10 h-10 mx-auto mb-4 text-slate-600 opacity-60" />
              <h3 className="text-xs font-semibold text-slate-400">No policies defined</h3>
              <p className="text-[11px] text-slate-500 mt-2">
                Create your first self-healing policy to enable automated incident response.
              </p>
            </div>
          ) : (
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950/80 text-[11px] text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4 font-semibold">Policy</th>
                  <th className="py-3 px-4 font-semibold">Trigger</th>
                  <th className="py-3 px-4 font-semibold">Actions</th>
                  <th className="py-3 px-4 font-semibold">Priority</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold text-right">Last Triggered</th>
                  <th className="py-3 px-4 font-semibold text-right">Success Rate</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {policies.map((policy) => {
                  const isEditing = editingId === policy.id;
                  const triggerText =
                    policy.triggerEvent === 'workflow_failure'
                      ? 'Workflow Failure'
                      : policy.triggerEvent === 'sla_breach'
                        ? 'SLA Breach Predicted'
                        : policy.triggerEvent === 'resource_exhaustion'
                          ? 'Resource Exhaustion'
                          : policy.triggerEvent === 'error_rate_surge'
                            ? 'Error Rate Surge'
                            : policy.triggerEvent === 'queue_depth_critical'
                              ? 'Critical Queue Depth'
                              : 'Manual Trigger';
                  const actionsText = policy.actions
                    .map((a) => {
                      switch (a.type) {
                        case 'notify': return 'Notify';
                        case 'auto_heal': return 'Auto-Heal';
                        case 'scale_resources': return 'Scale Resources';
                        case 'rollback': return 'Rollback';
                        case 'webhook': return 'Webhook';
                        default: return a.type;
                      }
                    })
                    .join(', ');
                  const statusColor = policy.isEnabled ? 'text-emerald-400' : 'text-slate-400';
                  const lastTriggered = policy.lastTriggered
                    ? new Date(policy.lastTriggered).toLocaleString()
                    : 'Never';

                  return (
                    <tr key={policy.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-4 px-4 font-medium text-slate-200 flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-indigo-300" />
                        <div className="flex flex-col">
                          <span className="text-[12px]">{policy.name}</span>
                          <span className="text-[10px] text-slate-500">{policy.description}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4">{triggerText}</td>
                      <td className="py-4 px-4">{actionsText}</td>
                      <td className="py-4 px-4">{policy.priority}</td>
                      <td className="py-4 px-4">
                        <span className={cn('text-[12px] font-semibold', statusColor)}>
                          {policy.isEnabled ? 'ENABLED' : 'DISABLED'}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-slate-400">{lastTriggered}</td>
                      <td className="py-4 px-4 text-slate-400">{policy.successRate}%</td>
                      <td className="py-4 px-4 text-right">
                        <div className="flex items-center justify-end gap-2 font-sans">
                          {!isEditing && (
                            <>
                              <button
                                onClick={() => handleEditPolicy(policy)}
                                title="Edit policy"
                                className="p-1 text-slate-400 hover:text-indigo-300 hover:bg-slate-800 rounded cursor-pointer transition-colors"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => onTogglePolicy(policy.id)}
                                title={policy.isEnabled ? 'Disable' : 'Enable'}
                                className="p-1 text-slate-400 hover:text-indigo-300 hover:bg-slate-800 rounded cursor-pointer transition-colors"
                              >
                                {policy.isEnabled ? (
                                  <X className="w-3.5 h-3.5" />
                                ) : (
                                  <Check className="w-3.5 h-3.5" />
                                )}
                              </button>
                              <button
                                onClick={() => onDeletePolicy(policy.id)}
                                title="Delete policy"
                                className="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded cursor-pointer transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
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
      )}
    </div>
  );
}

export default PolicyManager;