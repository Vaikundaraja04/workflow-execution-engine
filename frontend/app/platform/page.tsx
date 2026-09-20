import RegionDashboard from '@/features/global-platform/components/RegionDashboard';
import InfrastructureHealth from '@/features/global-platform/components/InfrastructureHealth';
import TenantDistribution from '@/features/global-platform/components/TenantDistribution';
import DeploymentStatus from '@/features/global-platform/components/DeploymentStatus';
import GlobalMetrics from '@/features/global-platform/components/GlobalMetrics';
import Link from 'next/link';

export default function PlatformOverview() {
  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">Global Platform Overview</h1>
      <nav className="mb-4 flex space-x-4">
        <Link href="/platform/regions" className="px-3 py-1 rounded bg-muted hover:bg-muted/80">
          Regions
        </Link>
        <Link href="/platform/infrastructure" className="px-3 py-1 rounded bg-muted hover:bg-muted/80">
          Infrastructure
        </Link>
        <Link href="/platform/tenants" className="px-3 py-1 rounded bg-muted hover:bg-muted/80">
          Tenants
        </Link>
        <Link href="/platform/deployments" className="px-3 py-1 rounded bg-muted hover:bg-muted/80">
          Deployments
        </Link>
      </nav>
      <div className="grid grid-cols-1 gap-6">
        <RegionDashboard />
        <InfrastructureHealth />
        <TenantDistribution />
        <DeploymentStatus />
        <GlobalMetrics />
      </div>
    </div>
  );
}