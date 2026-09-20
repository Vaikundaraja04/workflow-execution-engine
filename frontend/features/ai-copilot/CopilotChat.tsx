'use client';

import * as React from 'react';
import { Sparkles, Send, Bot, User, CornerDownLeft, CheckCircle2, Copy, RefreshCw, Zap, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  suggestedAction?: {
    type: 'apply_workflow' | 'add_node' | 'optimize' | 'fix_error';
    payload?: any;
    label: string;
  };
}

interface CopilotChatProps {
  workflowId?: string;
  initialContext?: string;
  onApplyAction?: (action: CopilotMessage['suggestedAction']) => void;
  className?: string;
}

export function CopilotChat({
  workflowId,
  initialContext,
  onApplyAction,
  className,
}: CopilotChatProps) {
  const [messages, setMessages] = React.useState<CopilotMessage[]>([
    {
      id: 'welcome-msg',
      role: 'assistant',
      content:
        "Hello! I am your AI Workflow Copilot. I can help you design new workflows, auto-wire nodes, configure complex steps, optimize performance, or diagnose execution failures. How can I assist you today?",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = React.useState('');
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  React.useEffect(() => {
    scrollToBottom();
  }, [messages, isGenerating]);

  const quickPrompts = [
    'Add an agent node with tool calling',
    'Synthesize an order processing pipeline',
    'Explain why the last execution failed',
    'Optimize sequential steps into parallel branches',
  ];

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = customPrompt || input.trim();
    if (!textToSend || isGenerating) return;

    const userMsg: CopilotMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!customPrompt) setInput('');
    setIsGenerating(true);

    // Simulate AI synthesis & intelligent reasoning response
    setTimeout(() => {
      let assistantMsg: CopilotMessage;

      if (textToSend.toLowerCase().includes('agent') || textToSend.toLowerCase().includes('tool')) {
        assistantMsg = {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content:
            "I've configured an AI Agent Node configured with `claude-sonnet-5` model, multi-turn reasoning enabled (maxTurns: 5), and standard enterprise tools (`http_request`, `database_query`, `summarize`). Would you like me to insert this into your workflow canvas?",
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          suggestedAction: {
            type: 'add_node',
            label: 'Insert AI Agent Node',
            payload: {
              type: 'agent',
              config: {
                model: 'claude-sonnet-5',
                maxTurns: 5,
                toolsAllowed: ['http_request', 'database_query', 'summarize'],
                orchestrationMode: 'autonomous',
              },
            },
          },
        };
      } else if (textToSend.toLowerCase().includes('order') || textToSend.toLowerCase().includes('pipeline')) {
        assistantMsg = {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content:
            "I have synthesized a 4-step Order Processing Pipeline:\n1. `Webhook Trigger` (listen for checkout events)\n2. `Condition Node` (validate fraud score & inventory)\n3. `AI Agent Node` (dynamic discount & notification reasoning)\n4. `HTTP Action` (charge payment gateway & emit dispatch event).",
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          suggestedAction: {
            type: 'apply_workflow',
            label: 'Apply Pipeline to Builder',
            payload: { nodeCount: 4, edgesCount: 3 },
          },
        };
      } else if (textToSend.toLowerCase().includes('optimize') || textToSend.toLowerCase().includes('parallel')) {
        assistantMsg = {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content:
            "Analysis complete. Step 2 (CRM Lookup) and Step 3 (Inventory Check) do not have mutual data dependencies. Converting them to parallel execution will reduce workflow latency by ~42% (from 1450ms to 840ms).",
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          suggestedAction: {
            type: 'optimize',
            label: 'Apply Parallel Conversion',
            payload: { convertedBranches: 2, estimatedLatencyReduction: '42%' },
          },
        };
      } else {
        assistantMsg = {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: `I've processed your request regarding "${textToSend}". All system safety checks and governance policies passed. I can auto-wire the required edges and configure error-handling fallback routes for you.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          suggestedAction: {
            type: 'apply_workflow',
            label: 'Update Workflow Canvas',
          },
        };
      }

      setMessages((prev) => [...prev, assistantMsg]);
      setIsGenerating(false);
    }, 900);
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className={cn('flex flex-col h-full bg-slate-900 text-slate-100 rounded-xl overflow-hidden border border-slate-800 shadow-2xl', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800">
        <div className="flex items-center space-x-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-xs">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
              AI Copilot
              <Badge variant="default" size="sm" className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-[10px]">
                Sonnet 5
              </Badge>
            </h3>
            <p className="text-[11px] text-slate-400">Autonomous workflow synthesis & diagnostics</p>
          </div>
        </div>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[300px] max-h-[500px]">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={cn('flex gap-3 text-xs leading-relaxed', isUser ? 'justify-end' : 'justify-start')}
            >
              {!isUser && (
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600/30 text-indigo-300 border border-indigo-500/40">
                  <Bot className="h-3.5 w-3.5" />
                </div>
              )}
              <div className={cn('max-w-[85%] space-y-2', isUser && 'flex flex-col items-end')}>
                <div
                  className={cn(
                    'p-3 rounded-xl border whitespace-pre-wrap',
                    isUser
                      ? 'bg-indigo-600 text-white border-indigo-500'
                      : 'bg-slate-800/90 text-slate-200 border-slate-700/80 shadow-xs'
                  )}
                >
                  {msg.content}
                </div>

                {/* Suggested Action Button */}
                {msg.suggestedAction && (
                  <div className="pt-1">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => onApplyAction && onApplyAction(msg.suggestedAction)}
                      className="text-xs h-7 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white border-0 shadow-md gap-1.5"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      {msg.suggestedAction.label}
                      <ArrowRight className="w-3 h-3 ml-0.5" />
                    </Button>
                  </div>
                )}

                <div className="flex items-center gap-2 px-1 text-[10px] text-slate-400">
                  <span>{msg.timestamp}</span>
                  {!isUser && (
                    <button
                      onClick={() => handleCopy(msg.id, msg.content)}
                      className="hover:text-slate-200 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      {copiedId === msg.id ? (
                        <>
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
              {isUser && (
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-700 text-slate-200">
                  <User className="h-3.5 w-3.5" />
                </div>
              )}
            </div>
          );
        })}

        {isGenerating && (
          <div className="flex items-center gap-2 text-xs text-indigo-400 font-medium py-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>AI Copilot is reasoning and analyzing graph topology...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Chips */}
      <div className="px-4 py-2 bg-slate-950/60 border-t border-slate-800/80 flex flex-wrap gap-1.5">
        {quickPrompts.map((prompt, idx) => (
          <button
            key={idx}
            onClick={() => handleSendMessage(prompt)}
            disabled={isGenerating}
            className="text-[11px] px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-all cursor-pointer disabled:opacity-50"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Input Area */}
      <div className="p-3 bg-slate-950 border-t border-slate-800">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Copilot to synthesize, optimize, or fix workflow..."
            disabled={isGenerating}
            className="flex-1 bg-slate-900 border border-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-3.5 py-2 text-xs text-white placeholder-slate-500 outline-none transition-all"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!input.trim() || isGenerating}
            className="h-8 px-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs"
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
        </form>
      </div>
    </div>
  );
}

export default CopilotChat;
