'use client';

import * as React from 'react';
import { predictiveIntelligenceApi } from '@/services/predictiveIntelligenceApi';
import type {
  FailurePredictionResult,
  PerformancePredictionResult,
  CapacityPredictionResult,
  CostPredictionResult,
  IPredictionAlert,
} from '@/types/predictiveIntelligence';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  AlertTriangle,
  TrendingUp,
  Activity,
  Clock,
  DollarSign,
  Cpu,
  RefreshCw,
} from 'lucide-react';


interface PredictionDashboardProps {
  workspaceId: string;
}

export function PredictionDashboard({ workspaceId }: PredictionDashboardProps) {
  const [failure, setFailure] = React.useState<FailurePredictionResult | null>(null);
  const [performance, setPerformance] = React.useState<PerformancePredictionResult | null>(null);
  const [capacity, setCapacity] = React.useState<CapacityPredictionResult | null>(null);
  const [cost, setCost] = React.useState<CostPredictionResult | null>(null);
  const [alerts, setAlerts] = React.useState<IPredictionAlert[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const loadPredictions = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [failureData, performanceData, capacityData, costData] = await Promise.all([
        predictiveIntelligenceApi.getFailurePredictions(workspaceId),
        predictiveIntelligenceApi.getPerformancePredictions(workspaceId),
        predictiveIntelligenceApi.getCapacityPredictions(workspaceId),
        predictiveIntelligenceApi.getCostPredictions(workspaceId),
      ]);
      setFailure(failureData);
      setPerformance(performanceData);
      setCapacity(capacityData);
      setCost(costData);
    } catch (err: any) {
      setError(err.message || 'Failed to load predictions');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const loadAlerts = React.useCallback(async () => {
    try {
      const alertsData = await predictiveIntelligenceApi.getAlerts(workspaceId);
      setAlerts(alertsData);
    } catch (err) {
      // Non-critical
    }
  }, [workspaceId]);

  React.useEffect(() => {
    void loadPredictions();
    void loadAlerts();
  }, [loadPredictions, loadAlerts]);

  const handleRunCycle = async () => {
    try {
      setLoading(true);
      const result = await predictiveIntelligenceApi.runPredictionCycle(workspaceId);
      setFailure(result.failure);
      setPerformance(result.performance);
      setCapacity(result.capacity);
      setCost(result.cost);
      setAlerts(result.alerts);
    } catch (err: any) {
      setError(err.message || 'Failed to run prediction cycle');
    } finally {
      setLoading(false);
    }
  };

  const handleAcknowledgeAlert = async (alertId: string) => {
    try {
      const updated = await predictiveIntelligenceApi.acknowledgeAlert(alertId, workspaceId);
      setAlerts((prev) => prev.map((a) => (a._id === alertId ? updated : a)));
    } catch (err) {
      // Ignore
    }
  };

  const handleResolveAlert = async (alertId: string) => {
    try {
      const updated = await predictiveIntelligenceApi.resolveAlert(alertId, workspaceId);
      setAlerts((prev) => prev.map((a) => (a._id === alertId ? updated : a)));
    } catch (err) {
      // Ignore
    }
  };

  const handleDismissAlert = async (alertId: string) => {
    try {
      const updated = await predictiveIntelligenceApi.dismissAlert(alertId, workspaceId);
      setAlerts((prev) => prev.filter((a) => a._id !== alertId));
    } catch (err) {
      // Ignore
    }
  };

  if (loading && !failure) {
    return (
      <div className="flex items-center justify-center p-12">
        <RefreshCw className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Predictive Intelligence Dashboard
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            AI-powered failure, performance, capacity, and cost predictions
          </p>
        </div>
        <Button onClick={handleRunCycle} disabled={loading} size="sm">
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Run Prediction Cycle
        </Button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Alert Summary */}
      {alerts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            <h3 className="font-semibold text-amber-800">Active Predictions</h3>
          </div>
          <div className="space-y-2">
            {alerts.slice(0, 5).map((alert) => (
              <div key={alert._id} className="flex items-center justify-between bg-white rounded p-2">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      alert.severity === 'critical'
                        ? 'destructive'
                        : alert.severity === 'high'
                          ? 'default'
                          : 'secondary'
                    }
                    size="sm"
                  >
                    {alert.severity}
                  </Badge>
                  <span className="text-sm text-gray-700">{alert.recommendation}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => handleAcknowledgeAlert(alert._id)}>Ack</Button>
                  <Button size="sm" variant="ghost" onClick={() => handleResolveAlert(alert._id)}>Resolve</Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDismissAlert(alert._id)}>Dismiss</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Prediction Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {failure && <FailureForecastCard failure={failure} />}
        {performance && <PerformanceForecastCard performance={performance} />}
        {capacity && <CapacityForecast capacity={capacity} />}
        {cost && <CostForecast cost={cost} />}
      </div>

      {/* Risk Timeline */}
      {failure && <RiskTimeline failure={failure} />}
    </div>
  );
}


interface FailureForecastCardProps {
  failure: FailurePredictionResult;
}

export function FailureForecastCard({ failure }: FailureForecastCardProps) {
  const riskColor =
    failure.riskLevel === 'critical'
      ? 'text-rose-600 bg-rose-50 border-rose-200'
      : failure.riskLevel === 'high'
        ? 'text-amber-600 bg-amber-50 border-amber-200'
        : failure.riskLevel === 'medium'
          ? 'text-yellow-600 bg-yellow-50 border-yellow-200'
          : 'text-emerald-600 bg-emerald-50 border-emerald-200';

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Failure Forecast</CardTitle>
        <AlertTriangle className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          <div className={`rounded-lg px-4 py-3 border ${riskColor}`}>
            <p className="text-3xl font-bold">{failure.failureProbability}%</p>
            <p className="text-xs font-medium capitalize">{failure.riskLevel} Risk</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Confidence</p>
            <p className="text-lg font-semibold">{failure.confidenceScore}%</p>
          </div>
        </div>

        {failure.riskyNodes.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Risky Nodes</p>
            {failure.riskyNodes.slice(0, 5).map((node) => (
              <div key={node.nodeId} className="flex items-center justify-between text-sm">
                <span className="font-medium">{node.nodeId}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" size="sm">{node.nodeType}</Badge>
                  <span className="text-xs text-muted-foreground">{node.failureLikelihood}%</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          Horizon: {failure.horizon} | Model: {failure.modelVersion}
        </div>
      </CardContent>
    </Card>
  );
}


interface PerformanceForecastCardProps {
  performance: PerformancePredictionResult;
}

export function PerformanceForecastCard({ performance }: PerformanceForecastCardProps) {
  const spikeColor =
    performance.latencySpikeRisk === 'high'
      ? 'text-rose-600'
      : performance.latencySpikeRisk === 'medium'
        ? 'text-amber-600'
        : 'text-emerald-600';

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Performance Forecast</CardTitle>
        <Activity className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Predicted Duration</p>
            <p className="text-xl font-bold">{performance.predictedDurationMs}ms</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">P95 Duration</p>
            <p className="text-xl font-bold">{performance.p95DurationMs}ms</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">P99 Duration</p>
            <p className="text-xl font-bold">{performance.p99DurationMs}ms</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Latency Spike Risk</p>
            <p className={`text-xl font-bold capitalize ${spikeColor}`}>{performance.latencySpikeRisk}</p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          Horizon: {performance.horizon} | Model: {performance.modelVersion}
        </div>
      </CardContent>
    </Card>
  );
}

interface CapacityForecastProps {
  capacity: CapacityPredictionResult;
}

export function CapacityForecast({ capacity }: CapacityForecastProps) {
  const isScaled = capacity.recommendedWorkerCount > capacity.currentWorkerCount;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Capacity Forecast</CardTitle>
        <Cpu className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Queue Depth Prediction</p>
            <p className="text-xl font-bold">{capacity.queueDepthPrediction}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Recommended Workers</p>
            <p className="text-xl font-bold">{capacity.recommendedWorkerCount}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Current Workers</p>
            <p className="text-xl font-bold">{capacity.currentWorkerCount}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Utilization Rate</p>
            <p className="text-xl font-bold">{capacity.utilizationRate}%</p>
          </div>
        </div>
        {isScaled && (
          <div className="mt-4 flex items-center gap-2 text-amber-600 text-sm">
            <TrendingUp className="w-4 h-4" />
            Scale up to {capacity.recommendedWorkerCount} workers recommended
          </div>
        )}
        <div className="mt-4 flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          Horizon: {capacity.horizon} | Model: {capacity.modelVersion}
        </div>
      </CardContent>
    </Card>
  );
}

interface CostForecastProps {
  cost: CostPredictionResult;
}

export function CostForecast({ cost }: CostForecastProps) {
  const totalGrowth = cost.totalMonthlyPrediction - (cost.currentMonthlyAiCost + cost.currentMonthlyExecutionCost + cost.currentMonthlyStorageCost);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Cost Forecast</CardTitle>
        <DollarSign className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">AI Cost Prediction</p>
            <p className="text-xl font-bold">${cost.monthlyAiCostPrediction.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Execution Cost Prediction</p>
            <p className="text-xl font-bold">${cost.monthlyExecutionCostPrediction.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Storage Cost Prediction</p>
            <p className="text-xl font-bold">${cost.monthlyStorageCostPrediction.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Monthly Prediction</p>
            <p className="text-xl font-bold">${cost.totalMonthlyPrediction.toFixed(2)}</p>
          </div>
        </div>
        {totalGrowth > 0 && (
          <div className="mt-4 flex items-center gap-2 text-amber-600 text-sm">
            <TrendingUp className="w-4 h-4" />
            Predicted cost increase: ${totalGrowth.toFixed(2)}/month
          </div>
        )}
        <div className="mt-4 flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          Horizon: {cost.horizon} | Model: {cost.modelVersion}
        </div>
      </CardContent>
    </Card>
  );
}


interface RiskTimelineProps {
  failure: FailurePredictionResult;
}

export function RiskTimeline({ failure }: RiskTimelineProps) {
  const riskScore = failure.failureProbability;
  const riskLevel = failure.riskLevel;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Risk Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Overall Failure Risk</span>
            <Badge
              variant={riskLevel === 'critical' ? 'destructive' : riskLevel === 'high' ? 'default' : riskLevel === 'medium' ? 'secondary' : 'outline'}
            >
              {riskLevel.toUpperCase()}
            </Badge>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 dark:bg-gray-700">
            <div
              className={`h-3 rounded-full ${
                riskLevel === 'critical'
                  ? 'bg-rose-500'
                  : riskLevel === 'high'
                    ? 'bg-amber-500'
                    : riskLevel === 'medium'
                      ? 'bg-yellow-500'
                      : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(riskScore, 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
          {failure.riskyNodes.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">Top Risky Nodes</p>
              <div className="space-y-2">
                {failure.riskyNodes.slice(0, 5).map((node) => (
                  <div key={node.nodeId} className="flex items-center justify-between">
                    <span className="text-sm font-medium">{node.nodeId}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 bg-gray-200 rounded-full h-2 dark:bg-gray-700">
                        <div
                          className={`h-2 rounded-full ${
                            node.failureLikelihood >= 80
                              ? 'bg-rose-500'
                              : node.failureLikelihood >= 50
                                ? 'bg-amber-500'
                                : 'bg-yellow-500'
                          }`}
                          style={{ width: `${Math.min(node.failureLikelihood, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">{node.failureLikelihood}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
