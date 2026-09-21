'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/Badge';
import type { PublisherProfileDTO } from '@/types/agentMarketplace';

export interface PublisherProfileProps {
  publisher: PublisherProfileDTO | null;
}

export function PublisherProfile({ publisher }: PublisherProfileProps) {
  if (!publisher) {
    return <p className="text-xs text-muted-foreground">Publisher profile unavailable.</p>;
  }
  return (
    <div className="space-y-1 text-xs" data-testid="publisher-profile">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{publisher.displayName}</span>
        {publisher.verified ? (
          <Badge variant="success" size="sm">
            verified
          </Badge>
        ) : null}
        <Badge variant="outline" size="sm">
          {publisher.publisherType}
        </Badge>
      </div>
      <p className="text-muted-foreground">
        {publisher.stats.publishedAgents} published agents | {publisher.stats.totalInstalls} installs |{' '}
        {publisher.stats.averageRating.toFixed(1)} avg rating
      </p>
    </div>
  );
}

export default PublisherProfile;