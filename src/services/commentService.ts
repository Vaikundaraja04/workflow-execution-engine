import { Types } from 'mongoose';
import { WorkflowCommentModel, type IWorkflowComment } from '../models/WorkflowCommentModel.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { UserModel } from '../models/UserModel.js';
import { checkUserPermission } from './permissionService.js';
import type { AuditAction } from '../models/AuditLogModel.js';
import { createAuditLog } from './auditService.js';
import { emitToWorkspace } from '../realtime/socketServer.js';

export interface CreateCommentDto {
  workflowId: string;
  workspaceId: string;
  content: string;
  nodeId?: string | undefined;
  parentCommentId?: string | undefined;
  mentions?: string[] | undefined;
}

export interface UpdateCommentDto {
  content?: string | undefined;
  status?: 'OPEN' | 'RESOLVED' | undefined;
}

export interface CommentWithAuthor {
  id: string;
  workflowId: string;
  workspaceId: string;
  authorId: string;
  authorName: string;
  authorEmail: string;
  nodeId?: string | undefined;
  content: string;
  parentCommentId?: string | null | undefined;
  mentions: string[];
  status: 'OPEN' | 'RESOLVED';
  resolvedBy?: string | null | undefined;
  resolvedAt?: Date | null | undefined;
  isEdited: boolean;
  editedAt?: Date | null | undefined;
  createdAt: Date;
  updatedAt: Date;
  replyCount?: number | undefined;
}

export class CommentService {
  /**
   * Create a new comment
   */
  async createComment(
    workspaceId: string,
    userId: string,
    dto: {
      workflowId: string;
      content: string;
      nodeId?: string | undefined;
      parentCommentId?: string | undefined;
      mentions?: string[] | undefined;
    },
  ): Promise<CommentWithAuthor> {
    // Validate ObjectIds
    if (
      !Types.ObjectId.isValid(dto.workflowId) ||
      !Types.ObjectId.isValid(workspaceId) ||
      !Types.ObjectId.isValid(userId)
    ) {
      throw new Error('INVALID_ID');
    }

    // Validate parentCommentId if provided
    if (dto.parentCommentId && !Types.ObjectId.isValid(dto.parentCommentId)) {
      throw new Error('INVALID_PARENT_COMMENT_ID');
    }

    // Check permissions
    const permissionCheck = await checkUserPermission(
      workspaceId,
      userId,
      'COLLABORATION_COMMENT',
    );

    if (permissionCheck.outcome !== 'allow' || !permissionCheck.membership) {
      throw new Error('PERMISSION_DENIED');
    }

    // Validate workflow belongs to workspace
    const workflow = await WorkflowModel.findById(dto.workflowId);
    if (!workflow) {
      throw new Error('WORKFLOW_NOT_FOUND');
    }

    if (!workflow.workspaceId || workflow.workspaceId.toString() !== workspaceId) {
      throw new Error('WORKFLOW_NOT_IN_WORKSPACE');
    }

    // If there's a parent comment, validate it belongs to the same workflow
    if (dto.parentCommentId) {
      const parentComment = await WorkflowCommentModel.findById(dto.parentCommentId);
      if (!parentComment || parentComment.workflowId.toString() !== dto.workflowId) {
        throw new Error('PARENT_COMMENT_NOT_FOUND');
      }
    }

    // Fetch user for author details
    const user = await UserModel.findById(userId);
    const authorEmail = user?.email ?? 'user@example.com';
    const authorName = authorEmail.split('@')[0] ?? 'User';

    // Create comment
    const comment = await WorkflowCommentModel.create({
      workflowId: new Types.ObjectId(dto.workflowId),
      workspaceId: new Types.ObjectId(workspaceId),
      authorId: new Types.ObjectId(userId),
      authorName,
      authorEmail,
      nodeId: dto.nodeId,
      content: dto.content,
      parentCommentId: dto.parentCommentId ? new Types.ObjectId(dto.parentCommentId) : undefined,
      mentions: dto.mentions ?? [],
    });

    // Create audit log
    await createAuditLog({
      userId,
      workspaceId,
      action: 'COMMENT_CREATED' as AuditAction,
      resource: 'WorkflowComment',
      resourceId: comment._id.toString(),
      metadata: {
        workflowId: dto.workflowId,
        nodeId: dto.nodeId,
        hasParent: !!dto.parentCommentId,
        mentionCount: (dto.mentions ?? []).length,
      },
    });

    // Emit real-time event
    emitToWorkspace(workspaceId, 'comment:created', {
      comment: this.toDto(comment),
    });

    return this.toDto(comment);
  }

  /**
   * Get comment by ID
   */
  async getCommentById(
    commentId: string,
    workspaceId: string,
    userId: string,
  ): Promise<CommentWithAuthor | null> {
    if (
      !Types.ObjectId.isValid(commentId) ||
      !Types.ObjectId.isValid(workspaceId) ||
      !Types.ObjectId.isValid(userId)
    ) {
      return null;
    }

    const comment = await WorkflowCommentModel.findById(commentId);
    if (!comment) return null;

    // Check workspace access
    const permissionCheck = await checkUserPermission(
      workspaceId,
      userId,
      'COLLABORATION_READ',
    );

    if (permissionCheck.outcome !== 'allow' || !permissionCheck.membership) {
      return null;
    }

    // Verify comment belongs to workspace
    if (comment.workspaceId.toString() !== workspaceId) {
      return null;
    }

    return this.toDto(comment);
  }

  /**
   * Get comments for a workflow
   */
  async getWorkflowComments(
    workflowId: string,
    workspaceId: string,
    userId: string,
    options: {
      limit?: number | undefined;
      offset?: number | undefined;
      status?: 'OPEN' | 'RESOLVED' | undefined;
      includeReplies?: boolean | undefined;
    } = {},
  ): Promise<{ comments: CommentWithAuthor[]; total: number }> {
    if (
      !Types.ObjectId.isValid(workflowId) ||
      !Types.ObjectId.isValid(workspaceId) ||
      !Types.ObjectId.isValid(userId)
    ) {
      return { comments: [], total: 0 };
    }

    // Check permissions
    const permissionCheck = await checkUserPermission(
      workspaceId,
      userId,
      'COLLABORATION_READ',
    );

    if (permissionCheck.outcome !== 'allow' || !permissionCheck.membership) {
      return { comments: [], total: 0 };
    }

    // Validate workflow belongs to workspace
    const workflow = await WorkflowModel.findById(workflowId);
    if (!workflow || !workflow.workspaceId || workflow.workspaceId.toString() !== workspaceId) {
      return { comments: [], total: 0 };
    }

    // Build query
    const query: Record<string, unknown> = {
      workflowId: new Types.ObjectId(workflowId),
      workspaceId: new Types.ObjectId(workspaceId),
    };

    if (options.status) {
      query.status = options.status;
    }

    if (!options.includeReplies) {
      query.parentCommentId = null; // Only top-level comments
    }

    // Get total count
    const total = await WorkflowCommentModel.countDocuments(query);

    // Get comments
    const comments = await WorkflowCommentModel.find(query)
      .sort({ createdAt: -1 })
      .skip(options.offset ?? 0)
      .limit(options.limit ?? 50)
      .lean();

    // Get reply counts for each comment
    const commentIds = comments.map((c: any) => c._id);
    const replyCounts = await WorkflowCommentModel.aggregate([
      { $match: { parentCommentId: { $in: commentIds } } },
      { $group: { _id: '$parentCommentId', count: { $sum: 1 } } },
    ]);

    const replyCountMap = new Map<string, number>();
    for (const rc of replyCounts) {
      replyCountMap.set(rc._id.toString(), rc.count);
    }

    return {
      comments: comments.map((c: any) => ({
        ...this.toDto(c),
        replyCount: replyCountMap.get(c._id.toString()) ?? 0,
      })),
      total,
    };
  }

  /**
   * Update comment
   */
  async updateComment(
    commentId: string,
    workspaceId: string,
    userId: string,
    dto: UpdateCommentDto,
  ): Promise<CommentWithAuthor> {
    if (
      !Types.ObjectId.isValid(commentId) ||
      !Types.ObjectId.isValid(workspaceId) ||
      !Types.ObjectId.isValid(userId)
    ) {
      throw new Error('INVALID_ID');
    }

    // Check permissions
    const permissionCheck = await checkUserPermission(
      workspaceId,
      userId,
      'COLLABORATION_COMMENT',
    );

    if (permissionCheck.outcome !== 'allow' || !permissionCheck.membership) {
      throw new Error('PERMISSION_DENIED');
    }

    // Get comment
    const comment = await WorkflowCommentModel.findById(commentId);
    if (!comment) {
      throw new Error('COMMENT_NOT_FOUND');
    }

    // Verify comment belongs to workspace
    if (comment.workspaceId.toString() !== workspaceId) {
      throw new Error('COMMENT_NOT_IN_WORKSPACE');
    }

    // Only author can edit their comment
    if (comment.authorId.toString() !== userId) {
      throw new Error('CANNOT_EDIT_OTHERS_COMMENT');
    }

    // Apply updates
    let hasChanges = false;

    if (dto.content !== undefined && dto.content !== comment.content) {
      comment.content = dto.content;
      comment.isEdited = true;
      comment.editedAt = new Date();
      hasChanges = true;
    }

    if (dto.status !== undefined && dto.status !== comment.status) {
      comment.status = dto.status;
      if (dto.status === 'RESOLVED') {
        comment.resolvedBy = new Types.ObjectId(userId);
        comment.resolvedAt = new Date();
      } else {
        comment.resolvedBy = undefined;
        comment.resolvedAt = undefined;
      }
      hasChanges = true;
    }

    if (!hasChanges) {
      return this.toDto(comment);
    }

    // Save comment
    await comment.save();

    // Create audit log
    await createAuditLog({
      userId,
      workspaceId,
      action: (dto.status === 'RESOLVED' ? 'COMMENT_RESOLVED' : 'COMMENT_UPDATED') as AuditAction,
      resource: 'WorkflowComment',
      resourceId: comment._id.toString(),
      metadata: {
        workflowId: comment.workflowId.toString(),
        nodeId: comment.nodeId,
        updatedFields: Object.keys(dto),
      },
    });

    // Emit real-time event
    const event = dto.status === 'RESOLVED' ? 'comment:resolved' : 'comment:updated';
    emitToWorkspace(workspaceId, event, {
      comment: this.toDto(comment),
    });

    return this.toDto(comment);
  }

  /**
   * Delete comment
   */
  async deleteComment(
    commentId: string,
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    if (
      !Types.ObjectId.isValid(commentId) ||
      !Types.ObjectId.isValid(workspaceId) ||
      !Types.ObjectId.isValid(userId)
    ) {
      throw new Error('INVALID_ID');
    }

    // Check permissions
    const permissionCheck = await checkUserPermission(
      workspaceId,
      userId,
      'COLLABORATION_MANAGE',
    );

    if (permissionCheck.outcome !== 'allow' || !permissionCheck.membership) {
      throw new Error('PERMISSION_DENIED');
    }

    const membership = permissionCheck.membership;

    // Get comment
    const comment = await WorkflowCommentModel.findById(commentId);
    if (!comment) {
      throw new Error('COMMENT_NOT_FOUND');
    }

    // Verify comment belongs to workspace
    if (comment.workspaceId.toString() !== workspaceId) {
      throw new Error('COMMENT_NOT_IN_WORKSPACE');
    }

    // Only author or workspace admin/owner can delete
    const isAuthor = comment.authorId.toString() === userId;
    const isAdminOrOwner = membership.role === 'OWNER' || membership.role === 'ADMIN';

    if (!isAuthor && !isAdminOrOwner) {
      throw new Error('CANNOT_DELETE_OTHERS_COMMENT');
    }

    await WorkflowCommentModel.deleteOne({ _id: comment._id });

    // Create audit log
    await createAuditLog({
      userId,
      workspaceId,
      action: 'COMMENT_DELETED' as AuditAction,
      resource: 'WorkflowComment',
      resourceId: commentId,
      metadata: {
        workflowId: comment.workflowId.toString(),
        nodeId: comment.nodeId,
        wasAuthor: isAuthor,
        wasResolved: comment.status === 'RESOLVED',
      },
    });

    // Emit real-time event
    emitToWorkspace(workspaceId, 'comment:deleted', {
      commentId,
      workflowId: comment.workflowId.toString(),
      deletedBy: userId,
    });
  }

  /**
   * Convert comment document to DTO
   */
  private toDto(comment: any): CommentWithAuthor {
    return {
      id: comment._id.toString(),
      workflowId: comment.workflowId.toString(),
      workspaceId: comment.workspaceId.toString(),
      authorId: comment.authorId.toString(),
      authorName: comment.authorName,
      authorEmail: comment.authorEmail,
      nodeId: comment.nodeId ?? undefined,
      content: comment.content,
      parentCommentId: comment.parentCommentId?.toString() ?? null,
      mentions: comment.mentions ?? [],
      status: comment.status,
      resolvedBy: comment.resolvedBy?.toString() ?? null,
      resolvedAt: comment.resolvedAt ?? null,
      isEdited: comment.isEdited ?? false,
      editedAt: comment.editedAt ?? null,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    };
  }
}

export const commentService = new CommentService();
