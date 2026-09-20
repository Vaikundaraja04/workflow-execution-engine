'use client';

import React, { useEffect, useState } from 'react';

interface Distribution {
  region: string;
  tenantCount: number;
  activeWorkflows: number;
}

const TenantDistribution: React.FC = () => {
  const [distribution, setDistribution] = useState<Distribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDistribution = async () => {
      try {
        const res = await fetch('/api/platform/tenants');
        if (!res.ok) throw new Error('Failed to fetch tenant distribution');
        const data = await res.json();
        setDistribution(data.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchDistribution();
  }, []);

  if (loading) return <div>Loading tenant distribution...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Tenant Distribution</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {distribution.map(item => (
          <div key={item.region} className="border rounded-lg p-4 bg-card text-card-foreground">
            <h2 className="text-lg font-semibold">{item.region}</h2>
            <div className="mt-2">
              <p className="text-sm text-muted-foreground">Tenants: <span className="font-medium text-foreground">{item.tenantCount}</span></p>
              <p className="text-sm text-muted-foreground">Active Workflows: <span className="font-medium text-foreground">{item.activeWorkflows}</span></p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TenantDistribution;
