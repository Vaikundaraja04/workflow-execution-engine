import React, { useState } from 'react';
import { CheckCircle2, Circle, MessageSquare, Trash2, CornerDownRight, Tag } from 'lucide-react';
import type { WorkflowComment } from '@/types/collaboration';
import { MentionInput } from './MentionInput';

interface CommentThreadProps {
  comment: WorkflowComment;
  currentUserId?: string;
  onReply: (parentCommentId: string, content: string, mentions: string[]) => void;
  onResolve: (commentId: string) => void;
  onReopen: (commentId: string) => void;
  onDelete: (commentId: string) => void;
  onSelectNode?: (nodeId: string) => void;
}

export const CommentThread: React.FC<CommentThreadProps> = ({
  comment,
  currentUserId,
  onReply,
  onResolve,
  onReopen,
  onDelete,
  onSelectNode,
}) => {
  const [showReplyInput, setShowReplyInput] = useState(false);
  const [isRepliesExpanded, setIsRepliesExpanded] = useState(true);

  const isResolved = comment.status === 'RESOLVED';
  const replies = comment.replies || [];
  const hasReplies = replies.length > 0;

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
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

  const renderContentWithMentions = (text: string) => {
    const parts = text.split(/(@[a-zA-Z0-9_-]+)/g);
    return parts.map((part, index) => {
      if (part.startsWith('@')) {
        return (
          <span
            key={index}
            className="text-blue-600 dark:text-blue-400 font-semibold bg-blue-50 dark:bg-blue-900/30 px-1 py-0.5 rounded"
          >
            {part}
          </span>
        );
      }
      return part;
    });
  };

  return (
    <div
      className={`border rounded-lg p-3 transition-colors ${
        isResolved
          ? 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700 opacity-75'
          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 shadow-sm'
      }`}
    >
      {/* Top Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold uppercase">
            {(comment.userName || comment.userEmail || 'U').slice(0, 2)}
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">
              {comment.userName || comment.userEmail}
            </div>
            <div className="text-[10px] text-gray-400">{formatDate(comment.createdAt)}</div>
          </div>
        </div>

        <div className="flex items-center space-x-1">
          {comment.nodeId && (
            <button
              onClick={() => onSelectNode?.(comment.nodeId!)}
              className="inline-flex items-center space-x-1 text-[11px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 hover:bg-purple-100"
              title={`Attached to node ${comment.nodeId}`}
            >
              <Tag className="w-3 h-3" />
              <span>{comment.nodeId}</span>
            </button>
          )}

          <button
            onClick={() => (isResolved ? onReopen(comment.id) : onResolve(comment.id))}
            className={`p-1 rounded text-xs transition-colors ${
              isResolved
                ? 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30'
                : 'text-gray-400 hover:text-green-600 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            title={isResolved ? 'Reopen comment' : 'Mark as resolved'}
          >
            {isResolved ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
          </button>

          {(currentUserId === comment.userId || !currentUserId) && (
            <button
              onClick={() => onDelete(comment.id)}
              className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-xs transition-colors"
              title="Delete thread"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Comment Body */}
      <div className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap pl-9 mb-2 leading-relaxed">
        {renderContentWithMentions(comment.content)}
      </div>

      {/* Action Footer */}
      <div className="flex items-center justify-between pl-9 pt-1 text-xs text-gray-500 border-t border-gray-100 dark:border-gray-700/50">
        <button
          onClick={() => setShowReplyInput(!showReplyInput)}
          className="inline-flex items-center space-x-1 text-blue-600 dark:text-blue-400 hover:underline"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Reply</span>
        </button>

        {hasReplies && (
          <button
            onClick={() => setIsRepliesExpanded(!isRepliesExpanded)}
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            {isRepliesExpanded
              ? `Hide replies (${replies.length})`
              : `Show replies (${replies.length})`}
          </button>
        )}
      </div>

      {/* Nested Replies */}
      {hasReplies && isRepliesExpanded && (
        <div className="mt-3 pl-6 space-y-2 border-l-2 border-gray-200 dark:border-gray-700">
          {replies.map((reply) => (
            <div key={reply.id} className="bg-gray-50 dark:bg-gray-800/60 rounded p-2 text-xs">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center space-x-1.5">
                  <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold">
                    {(reply.userName || reply.userEmail || 'U').slice(0, 2)}
                  </div>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    {reply.userName || reply.userEmail}
                  </span>
                  <span className="text-[10px] text-gray-400">{formatDate(reply.createdAt)}</span>
                </div>

                {(currentUserId === reply.userId || !currentUserId) && (
                  <button
                    onClick={() => onDelete(reply.id)}
                    className="text-gray-400 hover:text-red-500 p-0.5"
                    title="Delete reply"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="text-gray-800 dark:text-gray-200 pl-6 whitespace-pre-wrap">
                {renderContentWithMentions(reply.content)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reply Input Form */}
      {showReplyInput && (
        <div className="mt-3 pl-6 pt-2 border-t border-gray-100 dark:border-gray-700/50">
          <div className="flex items-center space-x-1 text-xs text-gray-500 mb-1">
            <CornerDownRight className="w-3.5 h-3.5" />
            <span>Replying to thread...</span>
          </div>
          <MentionInput
            placeholder="Write a reply..."
            autoFocus
            buttonText="Reply"
            onSubmit={(content, mentions) => {
              onReply(comment.id, content, mentions);
              setShowReplyInput(false);
            }}
          />
        </div>
      )}
    </div>
  );
};

export default CommentThread;
