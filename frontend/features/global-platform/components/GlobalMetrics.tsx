'use client';

import React, { useEffect, useState } from 'react';
import { apiClient } from '@/services/apiClient';

interface GlobalMetrics {
  totalExecutions24h: number;
  successRatePercent: number;
  avgLatencyMs: number;
  activeTenants: number;
}

const GlobalMetrics: React.FC = () => {
  const [metrics, setMetrics] = useState<GlobalMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await apiClient.get('/api/v1/platform/metrics');
        setMetrics(res.data.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, []);

  if (loading) return <div>Loading global metrics...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!metrics) return <div>No metrics available</div>;

  return (
    <div className="p-6 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg">
      <h1 className="text-2xl font-bold mb-4">Global Metrics</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="border rounded-lg p-4">
          <h2 className="text-lg font-medium">Executions (24h)</h2>
          <p className="text-3xl font-bold">{metrics.totalExecutions24h.toLocaleString()}</p>
        </div>
        <div className="border rounded-lg p-4">
          <h2 className="text-lg font-medium">Success Rate</h2>
          <p className="text-3xl font-bold">{metrics.successRatePercent}%</p>
        </div>
        <div className="border rounded-lg p-4">
          <h2 className="text-lg font-medium">Avg Latency</h2>
          <p className="text-3xl font-bold">{metrics.avgLatencyMs}ms</p>
        </div>
        <div className="border rounded-lg p-4">
          <h2 className="text-lg font-medium">Active Tenants</h2>
          <p className="text-3xl font-bold">{metrics.activeTenants.toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
};

export default GlobalMetrics;