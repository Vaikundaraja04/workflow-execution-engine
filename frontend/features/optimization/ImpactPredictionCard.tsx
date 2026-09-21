'use client';

import * as React from 'react';
import type { OptimizationExpectedImpact } from '@/types/optimization';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { TrendingUp, Clock, DollarSign, ShieldCheck } from 'lucide-react';

interface ImpactPredictionCardProps {
  impact: OptimizationExpectedImpact;
  confidence: number;
}

function impactRow(label: string, value: number | undefined, suffix: string, icon: React.ReactNode) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="text-sm font-semibold">
        {value !== undefined ? `${value}${suffix}` : 'n/a'}
      </span>
    </div>
  );
}

export function ImpactPredictionCard({ impact, confidence }: ImpactPredictionCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Predicted Impact</CardTitle>
        <TrendingUp className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-3">
        {impactRow('Latency reduction', impact.latencyReductionPercent, '%', <Clock className="h-3 w-3" />)}
        {impactRow('Cost reduction', impact.costReductionPercent, '%', <DollarSign className="h-3 w-3" />)}
        {impactRow('Reliability gain', impact.reliabilityGainPercent, '%', <ShieldCheck className="h-3 w-3" />)}
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-xs text-muted-foreground">Planning confidence</span>
          <span className="text-sm font-semibold">{confidence}%</span>
        </div>
        {impact.summary ? (
          <p className="text-xs text-muted-foreground">{impact.summary}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default ImpactPredictionCard;