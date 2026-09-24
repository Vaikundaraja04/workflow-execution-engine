import React, { useEffect, useState } from 'react';
import { useCollaborationStore } from '@/stores/collaborationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { CommentThread } from './CommentThread';
import { MentionInput } from './MentionInput';
import { Circle, Loader2 } from 'lucide-react';

export const CommentsPanel: React.FC<{ workflowId: string }> = ({ workflowId }) => {
  const {
    fetchWorkflowComments,
    workflowComments,
    commentLoading,
    createComment,
  } = useCollaborationStore();

  const { currentWorkspace } = useWorkspaceStore();
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const workspaceId = currentWorkspace?.id || '';

  useEffect(() => {
    if (workflowId) {
      // The store rethrows with a readable message; swallow it here so a
      // failed list load does not become an unhandled promise rejection.
      fetchWorkflowComments(workflowId, { limit: 50, offset: 0, includeResolved: true }).catch(() => {});
    }
  }, [workflowId, fetchWorkflowComments]);

  const handleCreateComment = async (content: string, mentions: string[]) => {
    if (!workflowId) return;
    try {
      await createComment(workflowId, { content, nodeId: undefined, parentCommentId: undefined, mentions });
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create comment';
      console.error('Failed to create comment:', message);
      setErrorMessage(message);
    }
  };

  const handleReply = async (parentCommentId: string, content: string, mentions: string[]) => {
    if (!workflowId) return;
    try {
      await createComment(workflowId, { content, nodeId: undefined, parentCommentId, mentions });
      setReplyingTo(null);
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create reply';
      console.error('Failed to create reply:', message);
      setErrorMessage(message);
    }
  };

  const handleResolve = async (commentId: string) => {
    try {
      // In a real app, we'd call a resolve API
      // For now, we'll just update optimistically and refetch
      setIsEditing(null);
      await fetchWorkflowComments(workflowId, { limit: 50, offset: 0, includeResolved: true });
    } catch (error) {
      console.error('Failed to resolve comment:', error);
    }
  };

  const handleReopen = async (commentId: string) => {
    try {
      // In a real app, we'd call a reopen API
      setIsEditing(null);
      await fetchWorkflowComments(workflowId, { limit: 50, offset: 0, includeResolved: true });
    } catch (error) {
      console.error('Failed to reopen comment:', error);
    }
  };

  const handleDelete = async (commentId: string) => {
    try {
      // In a real app, we'd call a delete API
      setIsEditing(null);
      await fetchWorkflowComments(workflowId, { limit: 50, offset: 0, includeResolved: true });
    } catch (error) {
      console.error('Failed to delete comment:', error);
    }
  };

  const handleStartEditing = (commentId: string, content: string) => {
    setIsEditing(commentId);
    setEditingContent(content);
  };

  const handleSaveEdit = async (commentId: string) => {
    if (!workflowId) return;
    try {
      // In a real app, we'd call an update API
      setIsEditing(null);
      await fetchWorkflowComments(workflowId, { limit: 50, offset: 0, includeResolved: true });
    } catch (error) {
      console.error('Failed to update comment:', error);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(null);
    setEditingContent('');
  };

  const comments = workflowComments[workflowId] || [];
  const topLevelComments = comments.filter(comment => !comment.parentCommentId);
  const commentReplies: Record<string, typeof comments> = {};

  // Group replies by parentCommentId
  comments.forEach(comment => {
    if (comment.parentCommentId) {
      if (!commentReplies[comment.parentCommentId]) {
        commentReplies[comment.parentCommentId] = [];
      }
      commentReplies[comment.parentCommentId]!.push(comment);
    }
  });

  // Attach replies to their parent comments
  const commentsWithReplies = topLevelComments.map(comment => ({
    ...comment,
    replies: commentReplies[comment.id] || [],
  }));

  return (
    <div className="space-y-4">
      {errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {errorMessage}
        </div>
      )}

      <div className="border-b pb-2">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Discussion ({comments.length})
        </h3>
      </div>

      {commentLoading[workflowId] && (
        <div className="text-center py-8">
          <Loader2 className="w-6 h-6 text-gray-400 dark:text-gray-500 mx-auto mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading comments...</p>
        </div>
      )}

      {!commentLoading[workflowId] && (
        <>
          {commentsWithReplies.map((comment) => (
            <CommentThread
              key={comment.id}
              comment={comment}
              currentUserId="current-user-id" // In a real app, this would come from auth
              onReply={handleReply}
              onResolve={handleResolve}
              onReopen={handleReopen}
              onDelete={handleDelete}
              onSelectNode={(nodeId) => {
                // In a real app, this would navigate to/select the node in the workflow builder
                console.log(`Selecting node: ${nodeId}`);
              }}
            />
          ))}

          {commentsWithReplies.length === 0 && (
            <div className="text-center py-8">
              <Circle className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No comments yet. Start the discussion!
              </p>
            </div>
          )}
        </>
      )}

      <div className="border-t pt-3">
        {isEditing ? (
          <div className="space-y-2">
            <textarea
              value={editingContent}
              onChange={(e) => setEditingContent(e.target.value)}
              rows={3}
              placeholder="Edit your comment..."
              className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 resize-none"
            />
            <div className="flex justify-end space-x-2">
              <button
                onClick={handleCancelEdit}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSaveEdit(isEditing!)}
                className="text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded"
                disabled={!editingContent.trim()}
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <MentionInput
            placeholder="Add a comment... Type @ to mention someone"
            autoFocus
            buttonText="Comment"
            onSubmit={handleCreateComment}
          />
        )}
      </div>
    </div>
  );
};

export default CommentsPanel;