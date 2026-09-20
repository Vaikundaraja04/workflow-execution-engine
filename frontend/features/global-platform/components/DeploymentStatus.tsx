'use client';

import React, { useEffect, useState } from 'react';

interface Deployment {
  version: string;
  region: string;
  mode: string;
  status: string;
  lastDeployedAt: string;
  replicaCount: number;
}

const DeploymentStatus: React.FC = () => {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDeployments = async () => {
      try {
        const res = await fetch('/api/platform/deployments');
        if (!res.ok) throw new Error('Failed to fetch deployments');
        const data = await res.json();
        setDeployments(data.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchDeployments();
  }, []);

  if (loading) return <div>Loading deployments...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Deployment Status</h1>
      <div className="overflow-x-auto">
        <table className="min-w-full border text-left text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="p-2 border">Region</th>
              <th className="p-2 border">Version</th>
              <th className="p-2 border">Mode</th>
              <th className="p-2 border">Status</th>
              <th className="p-2 border">Replicas</th>
              <th className="p-2 border">Last Deployed</th>
            </tr>
          </thead>
          <tbody>
            {deployments.map((dep, idx) => (
              <tr key={idx} className="border-t">
                <td className="p-2 border font-medium">{dep.region}</td>
                <td className="p-2 border">{dep.version}</td>
                <td className="p-2 border">{dep.mode}</td>
                <td className="p-2 border">
                  <span className={`px-2 py-1 rounded text-xs font-semibold ${
                    dep.status === 'DEPLOYED' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {dep.status}
                  </span>
                </td>
                <td className="p-2 border">{dep.replicaCount}</td>
                <td className="p-2 border">{new Date(dep.lastDeployedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DeploymentStatus;
