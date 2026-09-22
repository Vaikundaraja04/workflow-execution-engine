'use client';

import React, { useEffect, useState } from 'react';
import { apiClient } from '@/services/apiClient';

interface Region {
  code: string;
  name: string;
  status: string;
  workspaceCount: number;
  apiEndpoint: string;
  latencyMs: number;
}

const RegionDashboard: React.FC = () => {
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRegions = async () => {
      try {
        const res = await apiClient.get('/api/v1/platform/regions');
        setRegions(res.data.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchRegions();
  }, []);

  if (loading) return <div>Loading regions...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Region Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {regions.map(region => (
          <div key={region.code} className="border rounded-lg p-4">
            <h2 className="text-lg font-medium">{region.name}</h2>
            <p className="text-sm text-muted-foreground">
              Code: {region.code}
            </p>
            <p className="text-sm text-muted-foreground">
              Status: {region.status}
            </p>
            <p className="text-sm text-muted-foreground">
              Workspaces: {region.workspaceCount}
            </p>
            <p className="text-sm text-muted-foreground">
              Latency: {region.latencyMs}ms
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RegionDashboard;