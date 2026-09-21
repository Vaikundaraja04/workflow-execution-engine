'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { AgentVersionHistory } from './AgentVersionHistory';
import { AgentReviewPanel } from './AgentReviewPanel';
import { PublisherProfile } from './PublisherProfile';
import type {
  AgentMarketplaceDetailsDTO,
  AgentVersionComparisonDTO,
  AgentVersionDTO,
} from '@/types/agentMarketplace';

export interface AgentDetailsPanelProps {
  details: AgentMarketplaceDetailsDTO;
  versions: AgentVersionDTO[];
  comparison: AgentVersionComparisonDTO | null;
  canManage: boolean;
  canInstall: boolean;
  onInstall: () => void;
  onUninstall: () => void;
  onCompare: (from: number, to: number) => void;
  onRollback: (version: number) => void;
  onSubmitReview: (rating: number, review: string) => void;
  onClose: () => void;
}

export function AgentDetailsPanel(props: AgentDetailsPanelProps) {
  const { details, versions, comparison, canManage, canInstall } = props;
  const { listing, publisher, install, reviews } = details;
  const installed = install?.status === 'ACTIVE';

  return (
    <Card data-testid="agent-details-panel">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-sm font-medium">{listing.name}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {listing.category} | v{listing.versionCount} | publisher listed {new Date(listing.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" size="sm">
            {listing.visibility}
          </Badge>
          <Badge variant={listing.status === 'PUBLISHED' ? 'success' : 'outline'} size="sm">
            {listing.status}
          </Badge>
          <Button size="sm" variant="ghost" onClick={props.onClose}>
            Close
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-xs">
        <p>{listing.description}</p>
        {listing.documentation ? (
          <p className="rounded-md bg-gray-50 p-2 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            {listing.documentation}
          </p>
        ) : null}
        <PublisherProfile publisher={publisher} />

        <div className="flex flex-wrap items-center gap-2">
          {installed ? (
            <>
              <Badge variant="info" size="sm">
                installed v{install?.installedVersion}
              </Badge>
              <Button size="sm" variant="outline" disabled={!canInstall} onClick={props.onUninstall}>
                Uninstall
              </Button>
            </>
          ) : (
            <Button size="sm" disabled={!canInstall || listing.status !== 'PUBLISHED'} onClick={props.onInstall}>
              Install agent
            </Button>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold">Version history</p>
          <AgentVersionHistory
            versions={versions}
            canManage={canManage}
            comparison={comparison}
            onCompare={props.onCompare}
            onRollback={props.onRollback}
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold">Reviews</p>
          <AgentReviewPanel reviews={reviews} canReview={installed} onSubmit={props.onSubmitReview} />
        </div>
      </CardContent>
    </Card>
  );
}

export default AgentDetailsPanel;