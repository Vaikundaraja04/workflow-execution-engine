import React from 'react';
import { useOperationsStore } from '@/stores/operationsStore';
import {
  Activity,
  Server,
  Database,
  Cpu,
  HardDrive,
  Radio,
  Clock,
  Zap,
} from 'lucide-react';
import type { SystemObservabilityHealth, SystemMetricsData } from '@/types/operations.types';

interface ServiceCardProps {
  name: string;
  service: {
    status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
    [key: string]: any;
  };
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}

const ServiceCard: React.FC<ServiceCardProps> = ({ name, service, icon: Icon }) => {
  const getStatusColor = (status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY') => {
    switch (status) {
      case 'HEALTHY':
        return 'bg-emerald-500 text-white';
      case 'DEGRADED':
        return 'bg-yellow-500 text-black';
      case 'UNHEALTHY':
        return 'bg-rose-500 text-white';
      default:
        return 'bg-gray-500 text-white';
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 shadow-2xs">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-semibold text-gray-900 dark:text-white capitalize">{name}</h4>
            <span className={`inline-block px-2 py-0.5 mt-1 rounded text-xs font-medium ${getStatusColor(service.status)}`}>
              {service.status}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700/50 text-xs space-y-1 text-gray-600 dark:text-gray-300">
        {Object.entries(service)
          .filter(([key]) => key !== 'status')
          .map(([key, val]) => (
            <div key={key} className="flex justify-between">
              <span className="capitalize text-gray-500 dark:text-gray-400">
                {key.replace(/([A-Z])/g, ' $1').toLowerCase()}:
              </span>
              <span className="font-medium text-gray-800 dark:text-gray-200">
                {typeof val === 'number' && key.toLowerCase().includes('bytes')
                  ? `${Math.round(val / (1024 * 1024))} MB`
                  : typeof val === 'number' && key.toLowerCase().includes('ms')
                  ? `${val} ms`
                  : String(val)}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
};

export const SystemHealth: React.FC = () => {
  const { systemHealth, systemMetrics, isLoading, error, fetchSystemHealth, fetchSystemMetrics } = useOperationsStore();

  if (isLoading && !systemHealth) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center">
        <div className="w-10 h-10 mx-auto animate-spin rounded-full border-4 border-indigo-600 border-t-transparent"></div>
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Loading system observability...</p>
      </div>
    );
  }

  if (error && !systemHealth) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-rose-200 dark:border-rose-900 p-6">
        <div className="flex items-center gap-3 text-rose-600">
          <Zap className="w-5 h-5" />
          <h3 className="font-semibold">Failed to load system observability</h3>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">{error}</p>
        <button
          onClick={() => {
            fetchSystemHealth();
            fetchSystemMetrics();
          }}
          className="mt-4 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* System Overall Status */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 dark:border-gray-700 pb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-indigo-600" />
              Platform Observability & Real-Time Telemetry
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Active cluster status, queue latency, and infrastructure runtime health.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              Uptime: {systemHealth ? `${Math.floor(systemHealth.uptimeSeconds / 3600)}h ${Math.floor((systemHealth.uptimeSeconds % 3600) / 60)}m` : 'N/A'}
            </span>
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                systemHealth?.status === 'HEALTHY'
                  ? 'bg-emerald-500 text-white'
                  : systemHealth?.status === 'DEGRADED'
                  ? 'bg-yellow-500 text-black'
                  : 'bg-rose-500 text-white'
              }`}
            >
              {systemHealth?.status ?? 'UNKNOWN'}
            </span>
          </div>
        </div>

        {/* Real-time Metrics Grid */}
        {systemMetrics && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
            <div className="p-3 bg-gray-50 dark:bg-gray-900/60 rounded-lg">
              <div className="text-xs text-gray-500 dark:text-gray-400">CPU Load</div>
              <div className="text-lg font-bold text-gray-900 dark:text-white mt-1">
                {systemMetrics.cpuUsagePercent}%
              </div>
            </div>
            <div className="p-3 bg-gray-50 dark:bg-gray-900/60 rounded-lg">
              <div className="text-xs text-gray-500 dark:text-gray-400">Memory Usage</div>
              <div className="text-lg font-bold text-gray-900 dark:text-white mt-1">
                {systemMetrics.memoryUsagePercent}% ({systemMetrics.memoryUsedMb} MB)
              </div>
            </div>
            <div className="p-3 bg-gray-50 dark:bg-gray-900/60 rounded-lg">
              <div className="text-xs text-gray-500 dark:text-gray-400">API Throughput</div>
              <div className="text-lg font-bold text-gray-900 dark:text-white mt-1">
                {systemMetrics.apiThroughputRpm} RPM
              </div>
            </div>
            <div className="p-3 bg-gray-50 dark:bg-gray-900/60 rounded-lg">
              <div className="text-xs text-gray-500 dark:text-gray-400">Queue Depth</div>
              <div className="text-lg font-bold text-gray-900 dark:text-white mt-1">
                {systemMetrics.queueDepth} jobs
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Services Breakdown */}
      {systemHealth?.services && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <ServiceCard name="API Gateway" service={systemHealth.services.api} icon={Server} />
          <ServiceCard name="Database (MongoDB)" service={systemHealth.services.database} icon={Database} />
          <ServiceCard name="Redis Cache" service={systemHealth.services.redis} icon={Cpu} />
          <ServiceCard name="Execution Queues" service={systemHealth.services.queue} icon={HardDrive} />
          <ServiceCard name="Background Workers" service={systemHealth.services.workers} icon={Activity} />
          <ServiceCard name="WebSockets & Collab" service={systemHealth.services.websocket} icon={Radio} />
        </div>
      )}
    </div>
  );
};