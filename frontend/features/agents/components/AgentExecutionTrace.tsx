'use client';

import * as React from 'react';
import { Clock, AlertCircle, Bot } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import type { AgentRun, AgentRunTraceEvent, AgentRunToolCall } from '@/types/agent';

interface AgentExecutionTraceProps {
  run: AgentRun;
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
  thought: <Bot className="h-4 w-4 text-indigo-400" />,
  tool_call: <AlertCircle className="h-4 w-4 text-sky-400" />,
  tool_result: <Bot className="h-4 w-4 text-emerald-400" />,
  delegation: <Clock className="h-4 w-4 text-purple-400" />,
  final_output: <Bot className="h-4 w-4 text-foreground" />,
  approval_requested: <Clock className="h-4 w-4 text-amber-400" />,
  approval_resolved: <Bot className="h-4 w-4 text-emerald-400" />,
};

const STATUS_COLORS: Record<string, 'success' | 'destructive' | 'warning' | 'secondary'> = {
  SUCCEEDED: 'success',
  FAILED: 'destructive',
  DENIED: 'destructive',
  REQUIRES_APPROVAL: 'warning',
  PENDING: 'secondary',
};

export function AgentExecutionTrace({ run }: AgentExecutionTraceProps) {
  const formatDate = (d: string) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between p-4 border border-border rounded-xl bg-muted/20">
        <div className="flex items-center gap-3">
          <Badge variant={run.status === 'SUCCEEDED' ? 'success' : run.status === 'FAILED' ? 'destructive' : run.status === 'WAITING_APPROVAL' ? 'warning' : 'secondary'} size="sm">
            {run.status}
          </Badge>
          <span className="text-sm font-medium">Run #{run.id?.slice(-6) ?? '—'}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          Started {formatDate(run.startedAt)} • {run.completedAt ? `Completed ${formatDate(run.completedAt)}` : 'In progress'}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="p-3 border border-border rounded-lg">
          <div className="text-xl font-bold text-indigo-400">{run.tokenUsage?.promptTokens ?? 0}</div>
          <div className="text-xs text-muted-foreground">Prompt Tokens</div>
        </div>
        <div className="p-3 border border-border rounded-lg">
          <div className="text-xl font-bold text-sky-400">{run.tokenUsage?.completionTokens ?? 0}</div>
          <div className="text-xs text-muted-foreground">Completion Tokens</div>
        </div>
        <div className="p-3 border border-border rounded-lg">
          <div className="text-xl font-bold text-emerald-400">{run.tokenUsage?.totalTokens ?? 0}</div>
          <div className="text-xs text-muted-foreground">Total Tokens</div>
        </div>
      </div>

      {run.toolCalls.length > 0 && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="bg-muted/30 px-3 py-2 text-xs font-semibold text-muted-foreground">
            Tool Calls ({run.toolCalls.length})
          </div>
          <div className="divide-y divide-border">
            {run.toolCalls.map((call, i) => (
              <div key={i} className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-5">{i + 1}</span>
                  <Badge variant={STATUS_COLORS[call.status] ?? 'secondary'} size="sm">{call.status}</Badge>
                  <span className="font-medium text-sm">{call.toolName}</span>
                  {call.approvalId && <Badge variant="warning" size="sm">approval required</Badge>}
                </div>
                {call.executedAt && <span className="text-xs text-muted-foreground">{new Date(call.executedAt).toLocaleString()}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border border-border rounded-xl overflow-hidden">
        <div className="bg-muted/30 px-3 py-2 text-xs font-semibold text-muted-foreground">
          Execution Trace ({run.trace.length} events)
        </div>
        <div className="p-3 space-y-3 max-h-96 overflow-y-auto">
          {run.trace.length === 0 ? (
            <p className="text-xs text-muted-foreground">No trace events recorded.</p>
          ) : (
            run.trace.map((event, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex-shrink-0 w-5 h-5 rounded-full bg-muted/30 flex items-center justify-center">
                  <span className="text-xs text-muted-foreground">{i + 1}</span>
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    {ACTION_ICONS[event.action] ?? <AlertCircle className="h-4 w-4 text-muted-foreground" />}
                    <Badge variant="outline" size="sm" className="text-[10px]">{event.action}</Badge>
                    {event.toolName && <span className="font-medium text-xs">{event.toolName}</span>}
                    <span className="text-xs text-muted-foreground">{new Date(event.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p className="text-xs text-foreground leading-relaxed break-words">{event.content}</p>
                  {event.toolResult !== undefined && typeof event.toolResult !== 'string' && (
                    <pre className="text-xs bg-muted/30 p-2 rounded overflow-x-auto">
                      {JSON.stringify(event.toolResult, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {run.output && (
        <div className="border border-border rounded-xl p-4 bg-muted/10">
          <h4 className="text-xs font-semibold text-muted-foreground mb-2">Output</h4>
          <pre className="text-xs text-foreground whitespace-pre-wrap break-all font-mono">{run.output}</pre>
        </div>
      )}
    </div>
  );
}

export default AgentExecutionTrace;
