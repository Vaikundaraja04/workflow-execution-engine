'use client';

import * as React from 'react';
import { Star } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { AgentReviewDTO } from '@/types/agentMarketplace';

export interface AgentReviewPanelProps {
  reviews: AgentReviewDTO[];
  canReview: boolean;
  onSubmit: (rating: number, review: string) => void;
}

export function AgentReviewPanel({ reviews, canReview, onSubmit }: AgentReviewPanelProps) {
  const [rating, setRating] = React.useState(5);
  const [review, setReview] = React.useState('');
  return (
    <div className="space-y-3" data-testid="agent-review-panel">
      {reviews.length === 0 ? (
        <p className="text-xs text-muted-foreground">No reviews yet.</p>
      ) : (
        reviews.map((entry) => (
          <div key={entry._id} className="space-y-0.5 border-b pb-2 text-xs last:border-0 last:pb-0">
            <div className="flex items-center gap-2">
              <Badge variant="warning" size="sm">
                {entry.rating} / 5
              </Badge>
              <span className="text-muted-foreground">
                {new Date(entry.createdAt).toLocaleDateString()}
              </span>
            </div>
            {entry.review ? <p>{entry.review}</p> : null}
          </div>
        ))
      )}

      {canReview ? (
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                aria-label={`rate-${value}`}
                onClick={() => setRating(value)}
                className="p-0.5"
              >
                <Star
                  className={value <= rating ? 'h-4 w-4 text-amber-500' : 'h-4 w-4 text-muted-foreground'}
                />
              </button>
            ))}
          </div>
          <textarea
            value={review}
            onChange={(event) => setReview(event.target.value)}
            rows={3}
            placeholder="Share how this agent performed"
            className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900"
          />
          <Button
            size="sm"
            onClick={() => {
              onSubmit(rating, review);
              setReview('');
            }}
          >
            Submit review
          </Button>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">Install this agent to leave a verified review.</p>
      )}
    </div>
  );
}

export default AgentReviewPanel;