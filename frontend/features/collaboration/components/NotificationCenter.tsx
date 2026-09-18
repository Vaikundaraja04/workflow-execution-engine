import React, { useState, useEffect, useRef } from 'react';
import {
  Bell,
  Check,
  CheckCheck,
  Trash2,
  MessageSquare,
  Lock,
  Share2,
  CheckCircle2,
  XCircle,
  Users,
  Info,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { useCollaborationStore } from '@/stores/collaborationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { Notification, NotificationType } from '@/types/collaboration';
import Link from 'next/link';

interface NotificationCenterProps {
  className?: string;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({ className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const {
    notifications,
    unreadCount,
    notificationsLoading,
    fetchNotifications,
    getUnreadCount,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    deleteNotification,
  } = useCollaborationStore();

  const { currentWorkspace } = useWorkspaceStore();

  useEffect(() => {
    fetchNotifications({ limit: 30 });
    getUnreadCount();

    // Poll for notifications periodically
    const interval = setInterval(() => {
      getUnreadCount();
    }, 15000);

    return () => clearInterval(interval);
  }, [fetchNotifications, getUnreadCount, currentWorkspace?.id]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleToggle = () => {
    if (!isOpen) {
      fetchNotifications({ limit: 30 });
    }
    setIsOpen(!isOpen);
  };

  const getNotificationIcon = (type: NotificationType) => {
    switch (type) {
      case 'COMMENT_MENTION':
      case 'COMMENT_REPLY':
        return <MessageSquare className="w-4 h-4 text-blue-500" />;
      case 'WORKFLOW_LOCK_CONFLICT':
        return <Lock className="w-4 h-4 text-amber-500" />;
      case 'WORKFLOW_SHARED':
        return <Share2 className="w-4 h-4 text-purple-500" />;
      case 'EXECUTION_COMPLETED':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'EXECUTION_FAILED':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'WORKSPACE_INVITE':
        return <Users className="w-4 h-4 text-indigo-500" />;
      default:
        return <Info className="w-4 h-4 text-gray-500" />;
    }
  };

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
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  const filteredNotifications = notifications.filter((n) => {
    if (filter === 'unread') return !n.isRead;
    return true;
  });

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={handleToggle}
        className="relative p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus:outline-none"
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-red-500 rounded-full border-2 border-white dark:border-gray-900 shadow-sm animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col max-h-[500px]">
          {/* Header */}
          <div className="p-3.5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/30">
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Notifications
              </h3>
              {unreadCount > 0 && (
                <span className="text-[11px] font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">
                  {unreadCount} new
                </span>
              )}
            </div>

            <div className="flex items-center space-x-1">
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllNotificationsAsRead()}
                  className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center space-x-1 px-1.5 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20"
                  title="Mark all as read"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>Mark all read</span>
                </button>
              )}
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex border-b border-gray-100 dark:border-gray-800 bg-gray-50/30 dark:bg-gray-800/20 px-3 py-1.5 space-x-2 text-xs">
            <button
              onClick={() => setFilter('all')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                filter === 'all'
                  ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-xs'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              All ({notifications.length})
            </button>
            <button
              onClick={() => setFilter('unread')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                filter === 'unread'
                  ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-xs'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              Unread ({unreadCount})
            </button>
          </div>

          {/* List Content */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800/60">
            {notificationsLoading && notifications.length === 0 ? (
              <div className="p-8 text-center text-gray-500 dark:text-gray-400 flex flex-col items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400 mb-2" />
                <span className="text-xs">Loading notifications...</span>
              </div>
            ) : filteredNotifications.length === 0 ? (
              <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                <Bell className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2 opacity-50" />
                <p className="text-xs font-medium">
                  {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
                </p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  We'll notify you about workflow updates, mentions, and alerts.
                </p>
              </div>
            ) : (
              filteredNotifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`p-3 text-xs transition-colors flex items-start space-x-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
                    !notification.isRead
                      ? 'bg-blue-50/40 dark:bg-blue-950/20'
                      : 'bg-white dark:bg-gray-900'
                  }`}
                >
                  <div className="mt-0.5 shrink-0 p-1.5 rounded-lg bg-gray-100 dark:bg-gray-800">
                    {getNotificationIcon(notification.type)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {notification.title}
                      </span>
                      <span className="text-[10px] text-gray-400 shrink-0">
                        {formatDate(notification.createdAt)}
                      </span>
                    </div>

                    <p className="text-gray-600 dark:text-gray-300 line-clamp-2 leading-relaxed mb-1.5">
                      {notification.message}
                    </p>

                    {/* Metadata / Action Links */}
                    {notification.resourceType === 'WORKFLOW' && notification.resourceId && (
                      <Link
                        href={`/workflows/${notification.resourceId}/edit`}
                        onClick={() => {
                          if (!notification.isRead) markNotificationAsRead(notification.id);
                          setIsOpen(false);
                        }}
                        className="inline-flex items-center space-x-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-medium"
                      >
                        <span>View Workflow</span>
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    )}
                  </div>

                  <div className="flex flex-col items-center space-y-1 shrink-0 pt-0.5">
                    {!notification.isRead && (
                      <button
                        onClick={() => markNotificationAsRead(notification.id)}
                        className="p-1 text-gray-400 hover:text-blue-600 rounded transition-colors"
                        title="Mark as read"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => deleteNotification(notification.id)}
                      className="p-1 text-gray-400 hover:text-red-600 rounded transition-colors"
                      title="Delete notification"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationCenter;
