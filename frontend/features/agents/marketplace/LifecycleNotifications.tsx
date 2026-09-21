'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/Badge';
import type { MarketplaceLifecycleDTO } from '@/types/agentMarketplace';

export interface LifecycleNotificationsProps {
  data: MarketplaceLifecycleDTO | null;
}

export function LifecycleNotifications({ data }: LifecycleNotificationsProps) {
  if (!data) {
    return <p className="text-xs text-muted-foreground">Running lifecycle scan...</p>;
  }
  const events = [...data.installer.events, ...data.publisher.events];
  if (events.length === 0) {
    return <p className="text-xs text-muted-foreground">No lifecycle warnings. Everything is up to date.</p>;
  }

  return (
    <div className="space-y-2" data-testid="lifecycle-notifications">
      {events.map((event, index) => (
        <div
          key={`${event.listingId}-${event.type}-${index}`}
          className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-2 text-xs"
        >
          <div>
            <p className="font-medium">{event.listingName}</p>
            <p className="text-[11px] text-muted-foreground">{event.message}</p>
          </div>
          <Badge variant={event.severity === 'WARNING' ? 'warning' : 'outline'} size="sm">
            {event.type}
          </Badge>
        </div>
      ))}
    </div>
  );
}

export default LifecycleNotifications;