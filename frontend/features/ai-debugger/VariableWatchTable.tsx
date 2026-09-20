'use client';

import * as React from 'react';
import { Eye, Plus, Trash2, Edit3, Check, X, ArrowRight, Layers } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

export interface WatchVariable {
  id: string;
  name: string;
  type: string;
  value: any;
  previousValue?: any;
  scope: 'global' | 'step_input' | 'step_output' | 'state';
  isModified?: boolean;
}

interface VariableWatchTableProps {
  variables: WatchVariable[];
  onAddWatch?: (expression: string) => void;
  onRemoveWatch?: (id: string) => void;
  onMutateVariable?: (name: string, newValue: any) => void;
  className?: string;
}

export function VariableWatchTable({
  variables,
  onAddWatch,
  onRemoveWatch,
  onMutateVariable,
  className,
}: VariableWatchTableProps) {
  const [newExpr, setNewExpr] = React.useState('');
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExpr.trim() || !onAddWatch) return;
    onAddWatch(newExpr.trim());
    setNewExpr('');
  };

  const handleSaveMutation = (name: string) => {
    if (!onMutateVariable) return;
    try {
      const parsed = JSON.parse(editValue);
      onMutateVariable(name, parsed);
    } catch {
      onMutateVariable(name, editValue);
    }
    setEditingId(null);
  };

  return (
    <div className={cn('bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl flex flex-col', className)}>
      <div className="flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <Eye className="w-4 h-4 text-indigo-400" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">Live Variable Watch Table</h3>
        </div>
        <Badge variant="default" size="sm" className="bg-indigo-950 text-indigo-300 border-indigo-800 text-[10px]">
          {variables.length} in scope
        </Badge>
      </div>

      {/* Add Watch Form */}
      <form onSubmit={handleAdd} className="p-2.5 bg-slate-950/60 border-b border-slate-800/80 flex items-center gap-2">
        <input
          type="text"
          value={newExpr}
          onChange={(e) => setNewExpr(e.target.value)}
          placeholder="Add watch expression (e.g., payload.userId)..."
          className="flex-1 bg-slate-900 border border-slate-700 focus:border-indigo-500 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={!newExpr.trim()}
          className="h-7 text-xs px-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700"
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Watch
        </Button>
      </form>

      {/* Variables Table */}
      <div className="flex-1 overflow-x-auto overflow-y-auto max-h-[350px]">
        {variables.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs">
            <Layers className="w-8 h-8 mx-auto mb-2 text-slate-600 opacity-60" />
            No variables currently in active watch scope.
          </div>
        ) : (
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-[11px] text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-2 px-3 font-semibold">Variable</th>
                <th className="py-2 px-3 font-semibold">Scope</th>
                <th className="py-2 px-3 font-semibold">Type</th>
                <th className="py-2 px-3 font-semibold">Current Value</th>
                <th className="py-2 px-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {variables.map((v) => {
                const isEditing = editingId === v.id;
                const formattedVal = typeof v.value === 'object' ? JSON.stringify(v.value) : String(v.value);
                const hasChanged = v.previousValue !== undefined && JSON.stringify(v.previousValue) !== JSON.stringify(v.value);

                return (
                  <tr key={v.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-2.5 px-3 font-semibold text-indigo-300 flex items-center gap-1.5">
                      {v.name}
                      {hasChanged && (
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" title="Value changed in current step" />
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                        {v.scope}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-400 text-[11px]">{v.type}</td>
                    <td className="py-2.5 px-3 max-w-[240px] truncate">
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="bg-slate-950 border border-indigo-500 rounded px-2 py-0.5 text-xs text-white w-full outline-none"
                          />
                          <button
                            onClick={() => handleSaveMutation(v.name)}
                            className="p-1 text-emerald-400 hover:bg-slate-800 rounded"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="p-1 text-slate-400 hover:bg-slate-800 rounded"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className={cn('text-xs truncate', hasChanged ? 'text-amber-300 font-bold' : 'text-slate-200')}>
                            {formattedVal}
                          </span>
                          {hasChanged && (
                            <span className="text-[10px] text-slate-500 line-through truncate max-w-[80px]">
                              {JSON.stringify(v.previousValue)}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-1 font-sans">
                        {!isEditing && onMutateVariable && (
                          <button
                            onClick={() => {
                              setEditingId(v.id);
                              setEditValue(formattedVal);
                            }}
                            title="Mutate value on breakpoint"
                            className="p-1 text-slate-400 hover:text-indigo-300 hover:bg-slate-800 rounded cursor-pointer transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {onRemoveWatch && (
                          <button
                            onClick={() => onRemoveWatch(v.id)}
                            title="Remove watch"
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
    </div>
  );
}

export default VariableWatchTable;
