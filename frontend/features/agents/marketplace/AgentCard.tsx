'use client';

import * as React from 'react';
import { Star, Download, Bot } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { AgentMarketplaceListingDTO } from '@/types/agentMarketplace';

const STATUS_VARIANT = {
  PUBLISHED: 'success',
  DRAFT: 'warning',
  ARCHIVED: 'outline',
} as const;

export interface AgentCardProps {
  listing: AgentMarketplaceListingDTO;
  installed: boolean;
  canInstall: boolean;
  onView: (listingId: string) => void;
  onInstall: (listing: AgentMarketplaceListingDTO) => void;
}

export function AgentCard({ listing, installed, canInstall, onView, onInstall }: AgentCardProps) {
  return (
    <div className="space-y-3 rounded-xl border p-4 shadow-sm" data-testid="agent-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold">{listing.name}</p>
            <p className="text-[11px] text-muted-foreground">{listing.category}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={STATUS_VARIANT[listing.status] ?? 'outline'} size="sm">
            {listing.status}
          </Badge>
          <Badge variant="outline" size="sm">
            {listing.visibility}
          </Badge>
        </div>
      </div>

      <p className="line-clamp-2 text-xs text-muted-foreground">{listing.description}</p>

      {listing.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {listing.tags.slice(0, 4).map((tag) => (
            <Badge key={tag} variant="secondary" size="sm">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Star className="h-3 w-3 text-amber-500" />
          {listing.rating.count > 0
            ? `${listing.rating.average.toFixed(1)} (${listing.rating.count})`
            : 'No ratings'}
        </span>
        <span className="flex items-center gap-1">
          <Download className="h-3 w-3" />
          {listing.installCount} installs
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => onView(listing._id)}>
          Details
        </Button>
        {installed ? (
          <Badge variant="info" size="sm">
            installed
          </Badge>
        ) : (
          <Button size="sm" disabled={!canInstall} onClick={() => onInstall(listing)}>
            Install
          </Button>
        )}
      </div>
    </div>
  );
}

export default AgentCard;