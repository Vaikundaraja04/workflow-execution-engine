import React from 'react';
import type { PresenceState } from '@/types/collaboration';

interface UserAvatarStackProps {
  presences: PresenceState[];
  maxVisible?: number;
  size?: 'sm' | 'md' | 'lg';
}

export const UserAvatarStack: React.FC<UserAvatarStackProps> = ({
  presences = [],
  maxVisible = 4,
  size = 'md',
}) => {
  const visiblePresences = presences.slice(0, maxVisible);
  const overflowCount = Math.max(0, presences.length - maxVisible);

  const sizeClasses = {
    sm: 'w-6 h-6 text-xs',
    md: 'w-8 h-8 text-sm',
    lg: 'w-10 h-10 text-base',
  }[size];

  const getInitials = (name: string, email: string): string => {
    if (name && name.trim()) {
      const parts = name.trim().split(/\s+/);
      if (parts.length >= 2) {
        return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
      }
      return name.slice(0, 2).toUpperCase();
    }
    return (email || 'U').slice(0, 2).toUpperCase();
  };

  return (
    <div className="flex items-center -space-x-2 overflow-hidden">
      {visiblePresences.map((presence) => {
        const initials = getInitials(presence.name, presence.email);
        const color = presence.color || '#3B82F6';

        return (
          <div
            key={presence.userId}
            title={`${presence.name || presence.email} ${presence.workflowId ? '(Editing)' : '(Online)'}`}
            className={`relative inline-flex items-center justify-center rounded-full font-medium text-white border-2 border-white dark:border-gray-900 shadow-sm transition-transform hover:scale-110 hover:z-10 ${sizeClasses}`}
            style={{ backgroundColor: color }}
          >
            <span>{initials}</span>
            <span
              className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-green-500 border border-white dark:border-gray-900"
              title="Active now"
            />
          </div>
        );
      })}

      {overflowCount > 0 && (
        <div
          title={`${overflowCount} more users`}
          className={`relative inline-flex items-center justify-center rounded-full font-medium bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-2 border-white dark:border-gray-900 shadow-sm ${sizeClasses}`}
        >
          +{overflowCount}
        </div>
      )}
    </div>
  );
};

export default UserAvatarStack;
