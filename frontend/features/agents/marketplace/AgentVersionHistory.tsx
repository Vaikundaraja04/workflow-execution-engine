'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { AgentVersionDTO, AgentVersionComparisonDTO } from '@/types/agentMarketplace';

export interface AgentVersionHistoryProps {
  versions: AgentVersionDTO[];
  canManage: boolean;
  comparison: AgentVersionComparisonDTO | null;
  onCompare: (from: number, to: number) => void;
  onRollback: (version: number) => void;
}

export function AgentVersionHistory({
  versions,
  canManage,
  comparison,
  onCompare,
  onRollback,
}: AgentVersionHistoryProps) {
  if (versions.length === 0) {
    return <p className="text-xs text-muted-foreground">No versions published yet.</p>;
  }
  const latest = versions[0]?.versionNumber ?? 1;
  const previous = versions[1]?.versionNumber;

  return (
    <div className="space-y-2" data-testid="agent-version-history">
      {previous !== undefined ? (
        <Button size="sm" variant="outline" onClick={() => onCompare(previous, latest)}>
          Compare v{previous} to v{latest}
        </Button>
      ) : null}

      {comparison ? (
        <div className="rounded-md border p-2 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground">
            v{comparison.from.versionNumber} to v{comparison.to.versionNumber}
          </p>
          <p>
            Changed fields:{' '}
            {comparison.changedFields.length > 0 ? comparison.changedFields.join(', ') : 'none'}
          </p>
          <p>Tools added: {comparison.toolsAdded.length > 0 ? comparison.toolsAdded.join(', ') : 'none'}</p>
          <p>Tools removed: {comparison.toolsRemoved.length > 0 ? comparison.toolsRemoved.join(', ') : 'none'}</p>
        </div>
      ) : null}

      {versions.map((version) => (
        <div
          key={version._id}
          className="flex flex-wrap items-center justify-between gap-2 border-b pb-1.5 text-xs last:border-0 last:pb-0"
        >
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Badge variant="outline" size="sm">
                v{version.versionNumber}
              </Badge>
              {version.versionNumber === latest ? (
                <Badge variant="info" size="sm">
                  latest
                </Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground">{version.changeSummary || 'No change summary'}</p>
            <p className="font-mono text-[10px] text-muted-foreground">
              {version.hash.slice(0, 12)} | {new Date(version.createdAt).toLocaleString()}
            </p>
          </div>
          {canManage && version.versionNumber !== latest ? (
            <Button size="sm" variant="ghost" onClick={() => onRollback(version.versionNumber)}>
              Roll back
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default AgentVersionHistory;