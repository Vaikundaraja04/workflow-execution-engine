'use client';

import * as React from 'react';
import { CheckCircle2, XCircle, Clock, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Loading } from '@/components/ui/Loading';
import { cn } from '@/lib/utils';
import { agentApi } from '@/services/agentApi';
import type { ApprovalRequest } from '@/types/agent';

interface ApprovalQueueProps {
  workspaceId: string;
  onSelect?: (approval: ApprovalRequest) => void;
}

export function ApprovalQueue({ workspaceId, onSelect }: ApprovalQueueProps) {
  const [approvals, setApprovals] = React.useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [processingId, setProcessingId] = React.useState<string | null>(null);
  const [reasonInput, setReasonInput] = React.useState('');

  const fetchApprovals = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await agentApi.listApprovals(workspaceId, 'PENDING');
      setApprovals(data);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load approvals');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  React.useEffect(() => {
    void fetchApprovals();
  }, [fetchApprovals]);

  const handleDecision = async (approval: ApprovalRequest, decision: 'APPROVE' | 'REJECT') => {
    const agentId = approval.payload?.agentId as string | undefined;
    if (!agentId) return;
    setProcessingId(approval.id);
    try {
      const result = await agentApi.resolveApproval(workspaceId, agentId, approval.id, decision, reasonInput || undefined);
      setApprovals((prev) => prev.filter((a) => a.id !== approval.id));
      setReasonInput('');
    } catch (err: any) {
      setError(err?.message ?? `Failed to ${decision.toLowerCase()} approval`);
    } finally {
      setProcessingId(null);
    }
  };

  const pendingCount = approvals.length;

  if (loading) return <Loading message="Loading approval queue..." />;

  return (
    <div className="space-y-4">
      {error && <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">{error}</div>}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-amber-400" />
          <h3 className="text-lg font-semibold">Approval Queue</h3>
          {pendingCount > 0 && (
            <Badge variant="warning" size="sm">{pendingCount} pending</Badge>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={fetchApprovals}>
          <RefreshCw className="h-3 w-3 mr-1" /> Refresh
        </Button>
      </div>

      {pendingCount === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No pending approvals</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left py-2.5 px-4 font-medium">Resource</th>
                <th className="text-left py-2.5 px-4 font-medium">Action</th>
                <th className="text-left py-2.5 px-4 font-medium">Requested By</th>
                <th className="text-left py-2.5 px-4 font-medium">Expires</th>
                <th className="text-center py-2.5 px-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {approvals.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="py-2.5 px-4">
                    <div>
                      <span className="font-medium text-xs">{a.resourceType}</span>
                      <div className="text-xs text-muted-foreground truncate max-w-xs">{a.resourceId}</div>
                    </div>
                  </td>
                  <td className="py-2.5 px-4 font-mono text-xs">{a.action}</td>
                  <td className="py-2.5 px-4 text-xs">{a.requestedBy}</td>
                  <td className="py-2.5 px-4 text-xs text-muted-foreground">
                    {a.expiresAt ? new Date(a.expiresAt).toLocaleString() : '—'}
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDecision(a, 'REJECT')}
                        disabled={processingId === a.id}
                        className="h-7 px-2 text-xs"
                      >
                        <XCircle className="h-3 w-3 mr-1" /> Reject
                      </Button>
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => handleDecision(a, 'APPROVE')}
                        disabled={processingId === a.id}
                        className="h-7 px-2"
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Approve
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default ApprovalQueue;
