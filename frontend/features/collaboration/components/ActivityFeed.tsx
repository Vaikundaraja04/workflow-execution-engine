import React, { useEffect, useState } from 'react';
import {
  Activity,
  Filter,
  RefreshCw,
  Clock,
  User,
  Workflow,
  MessageSquare,
  Shield,
  Zap,
  Lock,
  Search,
  ChevronRight,
  Layers,
} from 'lucide-react';
import { useCollaborationStore } from '@/stores/collaborationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { ActivityItem, ActivityFilter } from '@/types/collaboration';
import Link from 'next/link';

interface ActivityFeedProps {
  workflowId?: string;
  limit?: number;
  className?: string;
  compact?: boolean;
}

export const ActivityFeed: React.FC<ActivityFeedProps> = ({
  workflowId,
  limit = 25,
  className = '',
  compact = false,
}) => {
  const { activityFeed, activityLoading, activityTotal, fetchActivityFeed } =
    useCollaborationStore();
  const { currentWorkspace } = useWorkspaceStore();

  const [filterAction, setFilterAction] = useState<string>('');
  const [filterResource, setFilterResource] = useState<string>(workflowId ? 'WORKFLOW' : '');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const loadActivities = () => {
    const filters: ActivityFilter = {
      limit,
      offset: 0,
    };
    if (filterAction) filters.action = filterAction;
    if (filterResource) filters.resource = filterResource;
    if (workflowId) {
      filters.resource = 'WORKFLOW';
    }
    fetchActivityFeed(filters);
  };

  useEffect(() => {
    loadActivities();
  }, [currentWorkspace?.id, filterAction, filterResource, workflowId]);

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMin / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMin < 1) return 'just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const getActionBadge = (action: string) => {
    if (action.includes('CREATE')) {
      return <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">Created</span>;
    }
    if (action.includes('UPDATE') || action.includes('EDIT')) {
      return <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">Updated</span>;
    }
    if (action.includes('DELETE')) {
      return <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300">Deleted</span>;
    }
    if (action.includes('LOCK')) {
      return <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">Locked</span>;
    }
    if (action.includes('EXECUTE') || action.includes('RUN')) {
      return <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">Executed</span>;
    }
    if (action.includes('RESOLVE')) {
      return <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300">Resolved</span>;
    }
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300">{action}</span>;
  };

  const getResourceIcon = (resource: string) => {
    switch (resource) {
      case 'WORKFLOW':
        return <Workflow className="w-4 h-4 text-blue-500" />;
      case 'COMMENT':
        return <MessageSquare className="w-4 h-4 text-indigo-500" />;
      case 'EXECUTION':
        return <Zap className="w-4 h-4 text-amber-500" />;
      case 'LOCK':
        return <Lock className="w-4 h-4 text-orange-500" />;
      case 'USER':
      case 'MEMBER':
        return <User className="w-4 h-4 text-green-500" />;
      case 'SECURITY':
      case 'API_KEY':
        return <Shield className="w-4 h-4 text-purple-500" />;
      default:
        return <Activity className="w-4 h-4 text-gray-500" />;
    }
  };

  const filteredFeed = activityFeed.filter((item) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      item.action.toLowerCase().includes(term) ||
      item.resource.toLowerCase().includes(term) ||
      (item.userName && item.userName.toLowerCase().includes(term)) ||
      (item.userEmail && item.userEmail.toLowerCase().includes(term))
    );
  });

  return (
    <div className={`flex flex-col bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm ${className}`}>
      {/* Header */}
      <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex flex-wrap items-center justify-between gap-3 bg-gray-50/50 dark:bg-gray-800/30">
        <div className="flex items-center space-x-2">
          <Activity className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Workspace Activity Feed
          </h3>
          <span className="text-xs text-gray-400">({activityTotal} events)</span>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => loadActivities()}
            disabled={activityLoading}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Refresh feed"
          >
            <RefreshCw className={`w-4 h-4 ${activityLoading ? 'animate-spin text-blue-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      {!compact && (
        <div className="p-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50/30 dark:bg-gray-800/10 flex flex-wrap items-center gap-2 text-xs">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search activity..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <select
            value={filterResource}
            onChange={(e) => setFilterResource(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">All Resources</option>
            <option value="WORKFLOW">Workflows</option>
            <option value="COMMENT">Comments</option>
            <option value="EXECUTION">Executions</option>
            <option value="LOCK">Locks</option>
            <option value="WORKSPACE">Workspace</option>
            <option value="API_KEY">API Keys</option>
          </select>

          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">All Actions</option>
            <option value="CREATE">Create</option>
            <option value="UPDATE">Update</option>
            <option value="DELETE">Delete</option>
            <option value="EXECUTE">Execute</option>
            <option value="LOCK">Lock</option>
          </select>
        </div>
      )}

      {/* Feed List */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800/60 max-h-[600px]">
        {activityLoading && activityFeed.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
            <p className="text-xs">Loading activity feed...</p>
          </div>
        ) : filteredFeed.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            <Layers className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2 opacity-50" />
            <p className="text-xs font-medium">No activity recorded yet</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Actions by team members across workflows and executions will appear here.
            </p>
          </div>
        ) : (
          filteredFeed.map((item) => (
            <div
              key={item.id}
              className="p-3.5 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors flex items-start space-x-3 text-xs"
            >
              {/* Resource Icon Badge */}
              <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800 shrink-0 mt-0.5">
                {getResourceIcon(item.resource)}
              </div>

              {/* Event Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2 mb-1 flex-wrap gap-y-1">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    {item.userName || item.userEmail || 'Team Member'}
                  </span>
                  {getActionBadge(item.action)}
                  <span className="text-gray-500 font-medium">
                    on {item.resource.toLowerCase()}
                  </span>
                  {item.resourceId && item.resource === 'WORKFLOW' && (
                    <Link
                      href={`/workflows/${item.resourceId}/edit`}
                      className="text-blue-600 dark:text-blue-400 hover:underline font-medium inline-flex items-center"
                    >
                      <span>#{item.resourceId.slice(0, 8)}</span>
                      <ChevronRight className="w-3 h-3 ml-0.5" />
                    </Link>
                  )}
                </div>

                {/* Metadata Summary if present */}
                {item.metadata && Object.keys(item.metadata).length > 0 && (
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 p-2 rounded border border-gray-100 dark:border-gray-800 mb-1">
                    {Object.entries(item.metadata).map(([k, v]) => (
                      <span key={k} className="mr-3">
                        <strong className="text-gray-700 dark:text-gray-300">{k}:</strong>{' '}
                        {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                      </span>
                    ))}
                  </div>
                )}

                {/* Timestamp & IP/Client info */}
                <div className="flex items-center space-x-2 text-[10px] text-gray-400">
                  <span className="flex items-center space-x-1">
                    <Clock className="w-3 h-3" />
                    <span>{formatDate(item.createdAt)}</span>
                  </span>
                  {item.ipAddress && (
                    <span>• IP: {item.ipAddress}</span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ActivityFeed;
