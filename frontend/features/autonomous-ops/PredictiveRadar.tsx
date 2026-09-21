'use client';

import * as React from 'react';
import { Activity, AlertTriangle, ShieldCheck, TrendingUp, CheckCircle, Clock, ArrowRight, Zap, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import type { FailurePredictionResult, PerformancePredictionResult, CapacityPredictionResult, CostPredictionResult } from '@/types/predictiveIntelligence';

export interface PredictiveAnomalyItem {
  id: string;
  workflowId: string;
  workflowName: string;
  anomalyType: 'queue_depth' | 'error_rate' | 'memory_pressure' | 'execution_drift' | 'sla_breach_risk';
  confidenceScore: number;
  predictedFailureTime?: string;
  recommendedAction: string;
  status: 'active' | 'acknowledged' | 'resolved' | 'dismissed';
  detectedAt: string;
}

interface PredictionData {
  failure?: FailurePredictionResult;
  performance?: PerformancePredictionResult;
  capacity?: CapacityPredictionResult;
  cost?: CostPredictionResult;
}

interface PredictiveRadarProps {
  anomalies: PredictiveAnomalyItem[];
  predictionData?: PredictionData;
  onAcknowledge?: (id: string) => void;
  onApplyRecommendation?: (id: string) => void;
  className?: string;
}

export function PredictiveRadar({
  anomalies,
  predictionData,
  onAcknowledge,
  onApplyRecommendation,
  className,
}: PredictiveRadarProps) {
  const activeAnomalies = anomalies.filter((a) => a.status === 'active' || a.status === 'acknowledged');
  const avgRiskScore =
    activeAnomalies.length > 0
      ? Math.round(activeAnomalies.reduce((sum, a) => sum + a.confidenceScore, 0) / activeAnomalies.length)
      : 0;

  const getRiskColor = (score: number) => {
    if (score >= 80) return 'text-rose-400 border-rose-500/30 bg-rose-500/10';
    if (score >= 50) return 'text-amber-400 border-amber-500/30 bg-amber-500/10';
    return 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10';
  };

  const getAnomalyTypeLabel = (type: PredictiveAnomalyItem['anomalyType']) => {
    switch (type) {
      case 'queue_depth':
        return 'Queue Depth Surge';
      case 'error_rate':
        return 'Error Rate Spike';
      case 'memory_pressure':
        return 'Memory Pressure Warning';
      case 'execution_drift':
        return 'Execution Latency Drift';
      case 'sla_breach_risk':
        return 'Imminent SLA Breach';
      default:
        return type;
    }
  };

  return (
    <div className={cn('bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl flex flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 bg-slate-950 border-b border-slate-800">
        <div className="flex items-center space-x-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-xs">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
              Predictive Operations Radar
              <Badge variant="default" size="sm" className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-[10px]">
                AI Proactive
              </Badge>
            </h2>
            <p className="text-[11px] text-slate-400">
              Pre-failure risk detection, execution drift analysis & automated prevention
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-900 border border-slate-800 rounded-lg">
            <span className="text-[11px] text-slate-400">Fleet Risk:</span>
            <span
              className={cn(
                'text-xs font-bold font-mono px-1.5 py-0.5 rounded border',
                getRiskColor(avgRiskScore)
              )}
            >
              {avgRiskScore}%
            </span>
          </div>
        </div>
      </div>

      {/* Anomaly Cards List */}
      <div className="p-5 space-y-3 flex-1 overflow-y-auto max-h-[450px]">
        {activeAnomalies.length === 0 ? (
          <div className="py-12 text-center text-slate-500">
            <ShieldCheck className="w-10 h-10 mx-auto mb-3 text-emerald-500/60" />
            <h3 className="text-xs font-semibold text-slate-300">All Systems Nominal</h3>
            <p className="text-[11px] text-slate-500 mt-1">
              No performance anomalies or failure risks detected across workflows.
            </p>

       {/* Prediction Data Section */}
       {predictionData && (
         <div className="px-5 py-3 bg-slate-900/50 border-b border-slate-800">
           <div className="flex items-center justify-between mb-2">
             <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">AI Predictions</span>
             <Badge variant="outline" size="sm" className="text-[10px] bg-slate-900 text-slate-400 border-slate-800">
               Live
             </Badge>
           </div>
           <div className="grid grid-cols-2 gap-2">
             {predictionData.failure && (
               <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2">
                 <div className="flex items-center justify-between">
                   <span className="text-[10px] text-slate-400">Failure Risk</span>
                   <span className={cn('text-xs font-bold font-mono',
                     predictionData.failure.riskLevel === 'critical' ? 'text-rose-400' :
                     predictionData.failure.riskLevel === 'high' ? 'text-amber-400' :
                     predictionData.failure.riskLevel === 'medium' ? 'text-yellow-400' : 'text-emerald-400'
                   )}>
                     {predictionData.failure.failureProbability}%
                   </span>
                 </div>
                 <div className="text-[10px] text-slate-500 mt-1">
                   {predictionData.failure.riskyNodes.length} risky nodes
                 </div>
               </div>
             )}
             {predictionData.performance && (
               <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2">
                 <div className="flex items-center justify-between">
                   <span className="text-[10px] text-slate-400">Latency Risk</span>
                   <span className={cn('text-xs font-bold font-mono',
                     predictionData.performance.latencySpikeRisk === 'high' ? 'text-rose-400' :
                     predictionData.performance.latencySpikeRisk === 'medium' ? 'text-amber-400' : 'text-emerald-400'
                   )}>
                     {predictionData.performance.latencySpikeRisk}
                   </span>
                 </div>
                 <div className="text-[10px] text-slate-500 mt-1">
                   P95: {predictionData.performance.p95DurationMs}ms
                 </div>
               </div>
             )}
             {predictionData.capacity && (
               <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2">
                 <div className="flex items-center justify-between">
                   <span className="text-[10px] text-slate-400">Queue Depth</span>
                   <span className="text-xs font-bold font-mono text-slate-300">
                     {predictionData.capacity.queueDepthPrediction}
                   </span>
                 </div>
                 <div className="text-[10px] text-slate-500 mt-1">
                   Workers: {predictionData.capacity.recommendedWorkerCount}
                 </div>
               </div>
             )}
             {predictionData.cost && (
               <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2">
                 <div className="flex items-center justify-between">
                   <span className="text-[10px] text-slate-400">Monthly Cost</span>
                   <span className="text-xs font-bold font-mono text-slate-300">
                     ${predictionData.cost.totalMonthlyPrediction.toFixed(0)}
                   </span>
                 </div>
                 <div className="text-[10px] text-slate-500 mt-1">
                   AI: ${predictionData.cost.monthlyAiCostPrediction.toFixed(0)}
                 </div>
               </div>
             )}
           </div>
         </div>
       )}
          </div>
        ) : (
          activeAnomalies.map((item) => (
            <div
              key={item.id}
              className="bg-slate-950/70 border border-slate-800 hover:border-slate-700/80 rounded-xl p-4 transition-all space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-white">{item.workflowName}</span>
                    <Badge variant="outline" size="sm" className="text-[10px] bg-slate-900 text-slate-400 border-slate-800">
                      {getAnomalyTypeLabel(item.anomalyType)}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-slate-400 flex items-center gap-2">
                    <span>Workflow ID: {item.workflowId.substring(0, 8)}...</span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-500" />
                      Detected {new Date(item.detectedAt).toLocaleTimeString()}
                    </span>
                  </p>
                </div>

                <div className="flex flex-col items-end">
                  <span className={cn('text-xs font-bold font-mono px-2 py-0.5 rounded border', getRiskColor(item.confidenceScore))}>
                    {item.confidenceScore}% Risk
                  </span>
                  {item.predictedFailureTime && (
                    <span className="text-[10px] text-rose-400 mt-1">
                      Failure est: in {Math.max(1, Math.round((new Date(item.predictedFailureTime).getTime() - Date.now()) / 60000))}m
                    </span>
                  )}
                </div>
              </div>

              {/* Recommendation Action Bar */}
              <div className="flex items-center justify-between gap-3 bg-slate-900/90 border border-slate-800 rounded-lg p-2.5">
                <div className="flex items-center gap-2 text-xs text-indigo-300 font-medium truncate">
                  <Zap className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
                  <span className="truncate">{item.recommendedAction}</span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {item.status === 'active' && onAcknowledge && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onAcknowledge(item.id)}
                      className="h-7 text-xs px-2.5 text-slate-400 hover:text-white"
                    >
                      Ack
                    </Button>
                  )}
                  {onApplyRecommendation && (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => onApplyRecommendation(item.id)}
                      className="h-7 text-xs px-3 bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5"
                    >
                      Apply Fix
                      <ArrowRight className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default PredictiveRadar;
