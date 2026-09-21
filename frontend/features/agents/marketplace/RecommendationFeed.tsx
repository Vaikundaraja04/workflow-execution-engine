'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { MarketplaceRecommendationsDTO } from '@/types/agentMarketplace';

export interface RecommendationFeedProps {
  data: MarketplaceRecommendationsDTO | null;
  canInstall: boolean;
  onInstall: (listingId: string) => void;
}

export function RecommendationFeed({ data, canInstall, onInstall }: RecommendationFeedProps) {
  if (!data) {
    return <p className="text-xs text-muted-foreground">Loading recommendations...</p>;
  }
  if (data.featurePolicy.decision === 'DENY') {
    return (
      <p className="text-xs text-amber-600">
        Recommendations are disabled by workspace governance ({data.featurePolicy.reasonCodes.join(', ')}).
      </p>
    );
  }
  if (data.items.length === 0) {
    return <p className="text-xs text-muted-foreground">No recommendations available yet.</p>;
  }

  return (
    <div className="space-y-2" data-testid="recommendation-feed">
      {data.items.map((item) => (
        <div key={item.listingId} className="space-y-1.5 rounded-lg border p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-medium">{item.name}</span>
              <Badge variant="outline" size="sm">
                {item.category}
              </Badge>
              <Badge variant="info" size="sm">
                score {item.score}
              </Badge>
            </div>
            <Button
              size="sm"
              disabled={!canInstall || !item.installable}
              onClick={() => onInstall(item.listingId)}
            >
              Install
            </Button>
          </div>
          <ul className="list-disc pl-4 text-[11px] text-muted-foreground">
            {item.reasons.slice(0, 3).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ))}
      {data.blockedByGovernance.length > 0 ? (
        <p className="text-[10px] text-muted-foreground">
          {data.blockedByGovernance.length} candidate(s) hidden by workspace governance.
        </p>
      ) : null}
    </div>
  );
}

export default RecommendationFeed;