import { useCollaborationStore } from '@/stores/collaborationStore';
import { UserAvatarStack } from './UserAvatarStack';
import { PresenceIndicator } from './PresenceIndicator';
import { useEffect } from 'react';

export const PresenceTracker = ({ workspaceId }: { workspaceId: string }) => {
  const { workspacePresences, joinWorkspace, leaveWorkspace } = useCollaborationStore();

  useEffect(() => {
    if (workspaceId) {
      joinWorkspace(workspaceId);
    }
    return () => {
      if (workspaceId) {
        leaveWorkspace(workspaceId);
      }
    };
  }, [workspaceId, joinWorkspace, leaveWorkspace]);

  const presences = workspacePresences[workspaceId] || [];

  return (
    <div className="flex items-center space-x-2">
      <PresenceIndicator />
      <UserAvatarStack presences={presences} />
    </div>
  );
};