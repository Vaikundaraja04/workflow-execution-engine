'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import type { MarketplaceAnalyticsDTO } from '@/types/agentMarketplace';

export interface PublisherAnalyticsPanelProps {
  analytics: MarketplaceAnalyticsDTO | null;
}

export function PublisherAnalyticsPanel({ analytics }: PublisherAnalyticsPanelProps) {
  if (!analytics) {
    return <p className="text-xs text-muted-foreground">Loading publisher analytics...</p>;
  }
  const { publisher } = analytics;

  return (
    <div className="space-y-4" data-testid="publisher-analytics-panel">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Listings</p>
          <p className="mt-1 text-lg font-semibold">
            {publisher.publishedListings} published / {publisher.archivedListings} archived
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Installs</p>
          <p className="mt-1 text-lg font-semibold">{publisher.lifetimeInstalls}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Active installs</p>
          <p className="mt-1 text-lg font-semibold">{publisher.activeInstalls}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Adoption</p>
          <p className="mt-1 text-lg font-semibold">{publisher.adoptionRate.toFixed(2)}</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Listing performance</CardTitle>
        </CardHeader>
        <CardContent>
          {publisher.perListing.length === 0 ? (
            <p className="text-xs text-muted-foreground">No listings published from this workspace yet.</p>
          ) : (
            <div className="space-y-2 text-xs">
              {publisher.perListing.map((listing) => (
                <div
                  key={listing.listingId}
                  className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{listing.name}</span>
                      <Badge variant={listing.status === 'PUBLISHED' ? 'success' : 'outline'} size="sm">
                        {listing.status}
                      </Badge>
                      <Badge variant="outline" size="sm">
                        v{listing.versionCount}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {listing.rating.count > 0
                        ? `${listing.rating.average.toFixed(1)} rating (${listing.rating.count})`
                        : 'No ratings yet'}
                    </p>
                  </div>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {listing.installs} installs | {listing.activeInstalls} active | {listing.executions} runs
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default PublisherAnalyticsPanel;