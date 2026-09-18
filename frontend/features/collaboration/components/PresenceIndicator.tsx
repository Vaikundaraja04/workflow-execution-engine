import { useCollaborationStore } from '@/stores/collaborationStore';
import { clsx } from 'clsx';

export const PresenceIndicator = () => {
  // In a real implementation, this would show the current user's presence status
  // For now, we'll show a simple online indicator
  return (
    <div className={clsx(
      'w-3 h-3',
      'bg-green-500',
      'rounded-full',
      'border-2',
      'border-white'
    )} />
  );
};