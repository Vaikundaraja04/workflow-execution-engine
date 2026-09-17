'use client';

import * as React from 'react';
import type { ExecutionLog } from '@/features/execution-console/types/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  Terminal,
  Search,
  Copy,
  Check,
  Download,
  Filter,
  ArrowDown,
  Trash2,
} from 'lucide-react';

interface ExecutionLogsProps {
  logs: ExecutionLog[];
  executionId?: string;
  workflowName?: string;
  className?: string;
}

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export function ExecutionLogs({
  logs,
  executionId = 'execution',
  workflowName = 'workflow',
  className = '',
}: ExecutionLogsProps) {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [enabledLevels, setEnabledLevels] = React.useState<Record<LogLevel, boolean>>({
    INFO: true,
    WARN: true,
    ERROR: true,
    DEBUG: true,
  });
  const [showTimestamp, setShowTimestamp] = React.useState(true);
  const [copied, setCopied] = React.useState(false);
  const [autoScroll, setAutoScroll] = React.useState(true);
  const logContainerRef = React.useRef<HTMLDivElement>(null);

  const toggleLevel = (level: LogLevel) => {
    setEnabledLevels((prev) => ({ ...prev, [level]: !prev[level] }));
  };

  // Filter logs based on search and selected levels
  const filteredLogs = React.useMemo(() => {
    return logs.filter((log) => {
      // Check level filter
      if (!enabledLevels[log.level]) return false;

      // Check search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchMsg = log.message.toLowerCase().includes(query);
        const matchNode = log.nodeId?.toLowerCase().includes(query);
        const matchLevel = log.level.toLowerCase().includes(query);
        return matchMsg || matchNode || matchLevel;
      }

      return true;
    });
  }, [logs, enabledLevels, searchQuery]);

  // Auto-scroll when logs change
  React.useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [filteredLogs, autoScroll]);

  // Copy all visible logs to clipboard
  const handleCopyLogs = () => {
    const text = filteredLogs
      .map((l) => `[${l.timestamp}] [${l.level}]${l.nodeId ? ` [Node: ${l.nodeId}]` : ''} ${l.message}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Download logs as .log file
  const handleDownloadLogs = () => {
    const text = filteredLogs
      .map((l) => `[${l.timestamp}] [${l.level}]${l.nodeId ? ` [Node: ${l.nodeId}]` : ''} ${l.message}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `execution-${executionId}-logs.log`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getLevelStyle = (level: LogLevel) => {
    switch (level) {
      case 'ERROR':
        return 'text-rose-400 bg-rose-950/40 border-rose-800/50';
      case 'WARN':
        return 'text-amber-400 bg-amber-950/40 border-amber-800/50';
      case 'INFO':
        return 'text-sky-400 bg-sky-950/40 border-sky-800/50';
      case 'DEBUG':
        return 'text-purple-400 bg-purple-950/40 border-purple-800/50';
      default:
        return 'text-gray-400 bg-gray-900 border-gray-800';
    }
  };

  return (
    <div className={`flex flex-col bg-gray-950 rounded-xl border border-gray-800 shadow-md overflow-hidden text-gray-200 font-mono ${className}`}>
      {/* Top Console Toolbar */}
      <div className="flex flex-wrap items-center justify-between p-3 border-b border-gray-800 bg-gray-900/80 gap-3">
        {/* Title */}
        <div className="flex items-center space-x-2">
          <Terminal className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-semibold text-gray-200 uppercase tracking-wider font-sans">
            Execution Console Logs
          </span>
          <span className="text-xs text-gray-500 font-sans">
            ({filteredLogs.length} / {logs.length} lines)
          </span>
        </div>

        {/* Level Toggles */}
        <div className="flex items-center space-x-1.5 font-sans">
          {(['INFO', 'WARN', 'ERROR', 'DEBUG'] as LogLevel[]).map((level) => {
            const active = enabledLevels[level];
            const badgeColor =
              level === 'ERROR'
                ? active ? 'bg-rose-600 text-white' : 'bg-gray-800 text-rose-400 opacity-60'
                : level === 'WARN'
                ? active ? 'bg-amber-600 text-white' : 'bg-gray-800 text-amber-400 opacity-60'
                : level === 'INFO'
                ? active ? 'bg-blue-600 text-white' : 'bg-gray-800 text-blue-400 opacity-60'
                : active ? 'bg-purple-600 text-white' : 'bg-gray-800 text-purple-400 opacity-60';

            return (
              <button
                key={level}
                onClick={() => toggleLevel(level)}
                className={`px-2 py-0.5 text-[11px] font-semibold rounded transition-all cursor-pointer ${badgeColor}`}
              >
                {level}
              </button>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex items-center space-x-2 font-sans">
          <button
            onClick={() => setShowTimestamp(!showTimestamp)}
            className={`px-2 py-1 text-xs rounded border transition-colors cursor-pointer ${
              showTimestamp
                ? 'bg-gray-800 border-gray-700 text-gray-200'
                : 'bg-transparent border-gray-800 text-gray-500'
            }`}
          >
            Timestamp
          </button>
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            title="Auto-scroll to bottom"
            className={`p-1 rounded border transition-colors cursor-pointer ${
              autoScroll
                ? 'bg-blue-900/50 border-blue-700 text-blue-300'
                : 'bg-transparent border-gray-800 text-gray-500'
            }`}
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleCopyLogs}
            className="flex items-center space-x-1 px-2.5 py-1 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-gray-200 transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-gray-300" />
                <span>Copy</span>
              </>
            )}
          </button>
          <button
            onClick={handleDownloadLogs}
            className="flex items-center space-x-1 px-2.5 py-1 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-gray-200 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-gray-300" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Search Input Bar */}
      <div className="p-2 border-b border-gray-800 bg-gray-900/40">
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 w-3.5 h-3.5 text-gray-500" />
          <input
            type="text"
            placeholder="Filter log output..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1 bg-gray-950 border border-gray-800 rounded text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono"
          />
        </div>
      </div>

      {/* Log Output Console */}
      <div
        ref={logContainerRef}
        className="flex-1 p-3 overflow-y-auto max-h-[400px] min-h-[220px] space-y-1.5 text-xs select-text"
      >
        {filteredLogs.length === 0 ? (
          <div className="py-8 text-center text-gray-600 font-sans text-xs">
            {logs.length === 0 ? 'No logs available for this execution.' : 'No matching log statements found.'}
          </div>
        ) : (
          filteredLogs.map((log, index) => (
            <div
              key={index}
              className="flex items-start space-x-2 leading-relaxed hover:bg-gray-900/60 rounded px-1.5 py-0.5 transition-colors"
            >
              {showTimestamp && (
                <span className="text-gray-500 shrink-0 text-[11px] select-none">
                  {new Date(log.timestamp).toISOString().split('T')[1].replace('Z', '')}
                </span>
              )}
              <span
                className={`px-1.5 py-0.2 rounded border text-[10px] font-bold shrink-0 select-none ${getLevelStyle(
                  log.level
                )}`}
              >
                {log.level}
              </span>
              {log.nodeId && (
                <span className="text-gray-400 bg-gray-900 px-1 py-0.2 rounded text-[10px] font-mono shrink-0 select-none border border-gray-800">
                  [{log.nodeId}]
                </span>
              )}
              <span className="text-gray-200 break-all whitespace-pre-wrap">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default ExecutionLogs;
