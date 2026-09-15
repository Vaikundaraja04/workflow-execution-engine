import { Types } from 'mongoose';

export function tenantScope(userId: string, workspaceId: string) {
  return {
    $or: [
      { workspaceId: new Types.ObjectId(workspaceId) },
      { workspaceId: { $exists: false }, ownerId: new Types.ObjectId(userId) },
      { workspaceId: null, ownerId: new Types.ObjectId(userId) },
    ],
  };
}
