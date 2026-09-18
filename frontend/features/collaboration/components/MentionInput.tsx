import React, { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';

interface MentionInputProps {
  placeholder?: string;
  onSubmit: (content: string, mentions: string[]) => void;
  isLoading?: boolean;
  autoFocus?: boolean;
  buttonText?: string;
}

export const MentionInput: React.FC<MentionInputProps> = ({
  placeholder = 'Add a comment... Type @ to mention someone',
  onSubmit,
  isLoading = false,
  autoFocus = false,
  buttonText = 'Send',
}) => {
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  const extractMentions = (text: string): string[] => {
    const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
    const matches: string[] = [];
    let match;
    while ((match = mentionRegex.exec(text)) !== null) {
      if (match[1]) {
        matches.push(match[1]);
      }
    }
    return Array.from(new Set(matches));
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!content.trim() || isLoading) return;

    const mentions = extractMentions(content);
    onSubmit(content.trim(), mentions);
    setContent('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={3}
          disabled={isLoading}
          className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 resize-none disabled:opacity-50"
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          Press <kbd className="px-1 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 rounded border">Ctrl+Enter</kbd> to submit
        </span>
        <button
          type="submit"
          disabled={!content.trim() || isLoading}
          className="inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 rounded-lg shadow-sm transition-colors"
        >
          <span>{buttonText}</span>
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </form>
  );
};

export default MentionInput;
