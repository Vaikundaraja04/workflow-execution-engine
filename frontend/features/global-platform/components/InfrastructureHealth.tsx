'use client';

import React, { useEffect, useState } from 'react';
import { apiClient } from '@/services/apiClient';

interface NodeHealth {
  id: string;
  name: string;
  region: string;
  role: 'api' | 'worker' | 'database' | 'redis';
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  cpuUsagePercent: number;
  memoryUsagePercent: number;
  activeJobs: number;
  uptimeSeconds: number;
}

const InfrastructureHealth: React.FC = () => {
  const [nodes, setNodes] = useState<NodeHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await apiClient.get('/api/v1/platform/infrastructure');
        setNodes(res.data.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchHealth();
  }, []);

  if (loading) return <div>Loading infrastructure health...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Infrastructure Health</h1>
      <div className="overflow-x-auto">
        <table className="min-w-full border text-left text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="p-2 border">Node</th>
              <th className="p-2 border">Region</th>
              <th className="p-2 border">Role</th>
              <th className="p-2 border">Status</th>
              <th className="p-2 border">CPU</th>
              <th className="p-2 border">Memory</th>
              <th className="p-2 border">Active Jobs</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map(node => (
              <tr key={node.id} className="border-t">
                <td className="p-2 border font-medium">{node.name}</td>
                <td className="p-2 border">{node.region}</td>
                <td className="p-2 border">{node.role}</td>
                <td className="p-2 border">
                  <span className={`px-2 py-1 rounded text-xs font-semibold ${
                    node.status === 'HEALTHY' ? 'bg-green-100 text-green-800' :
                    node.status === 'DEGRADED' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {node.status}
                  </span>
                </td>
                <td className="p-2 border">{node.cpuUsagePercent}%</td>
                <td className="p-2 border">{node.memoryUsagePercent}%</td>
                <td className="p-2 border">{node.activeJobs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default InfrastructureHealth;
