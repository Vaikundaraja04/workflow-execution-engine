import * as React from 'react';
import { AlertTriangle, CheckCircle2, Search, Info, AlertCircle } from 'lucide-react';
import { useWorkflowBuilderStore } from '../stores/workflowBuilderStore';
import { Button } from '@/components/ui/Button';

export const ValidationPanel: React.FC = () => {
  const {
    validationErrors,
    validationWarnings,
    isValidating,
    validateGraphLocally,
    setSelectedNodeId,
    isReadOnly,
  } = useWorkflowBuilderStore();

  React.useEffect(() => {
    if (!isReadOnly) {
      validateGraphLocally();
    }
  }, [isReadOnly, validateGraphLocally]);

  const hasErrors = validationErrors.length > 0;
  const hasWarnings = validationWarnings.length > 0;
  const isValid = validationErrors.length === 0;

  const handleNodeClick = (nodeId?: string) => {
    if (nodeId) {
      setSelectedNodeId(nodeId);
    }
  };

  return (
    <div className="flex h-full flex-col bg-white border-l border-gray-200 overflow-y-auto">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between space-x-2">
        <h4 className="text-xs font-semibold text-gray-800 uppercase tracking-wider">
          Validation Panel
        </h4>
        <Button
          variant="outline"
          size="sm"
          onClick={validateGraphLocally}
          disabled={isReadOnly || isValidating}
          className="px-2 py-0.5 text-xs h-7"
        >
          <Search className="h-3 w-3 mr-1" /> Revalidate
        </Button>
      </div>

      {/* Status Summary */}
      <div className="p-3 border-b">
        <div className="flex items-center space-x-2">
          {isValid ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-900">
              {isValid ? 'Workflow graph is valid' : 'Validation issues detected'}
            </p>
            <p className="text-[11px] text-gray-500">
              {hasErrors ? `${validationErrors.length} error(s)` : 'Ready to save or publish'}
            </p>
          </div>
        </div>

        {hasWarnings && (
          <div className="mt-2 p-2 bg-amber-50 rounded text-[11px] text-amber-800 border border-amber-200 flex items-start space-x-1.5">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600" />
            <span>{validationWarnings.length} warning(s) - check reachability or unused steps.</span>
          </div>
        )}
      </div>

      {/* Error Details */}
      {hasErrors ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          <h4 className="text-[11px] font-semibold text-gray-700 mb-1">
            Errors ({validationErrors.length})
          </h4>
          <div className="space-y-1.5 text-[11px]">
            {validationErrors.map((err, index) => (
              <div
                key={index}
                onClick={() => handleNodeClick(err.nodeId)}
                className={`p-2 border rounded-lg bg-rose-50/70 border-rose-200 ${
                  err.nodeId ? 'cursor-pointer hover:bg-rose-100/70 transition-colors' : ''
                }`}
              >
                <div className="flex items-start space-x-2">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-destructive shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-destructive">{err.message}</p>
                    {err.nodeId && (
                      <span className="block text-[10px] text-gray-600 mt-0.5">
                        Node: <code className="bg-rose-100 px-1 rounded text-[10px]">{err.nodeId}</code>
                      </span>
                    )}
                    {err.edge && (
                      <span className="block text-[10px] text-gray-600 mt-0.5">
                        Edge: <code className="bg-rose-100 px-1 rounded text-[10px]">{err.edge.source} → {err.edge.target}</code>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {hasWarnings && (
            <div className="mt-3 space-y-1.5 text-[11px]">
              <h4 className="text-[11px] font-semibold text-gray-700 mb-1">
                Warnings ({validationWarnings.length})
              </h4>
              {validationWarnings.map((warn, index) => (
                <div
                  key={index}
                  onClick={() => handleNodeClick(warn.nodeId)}
                  className={`p-2 border rounded-lg bg-amber-50/70 border-amber-200 ${
                    warn.nodeId ? 'cursor-pointer hover:bg-amber-100/70 transition-colors' : ''
                  }`}
                >
                  <div className="flex items-start space-x-2">
                    <Info className="h-3.5 w-3.5 mt-0.5 text-amber-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-amber-900">{warn.message}</p>
                      {warn.nodeId && (
                        <span className="block text-[10px] text-gray-600 mt-0.5">
                          Node: <code className="bg-amber-100 px-1 rounded text-[10px]">{warn.nodeId}</code>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center py-8 px-4 text-center">
          <CheckCircle2 className="h-8 w-8 mb-2 text-emerald-500" />
          <h4 className="text-xs font-semibold text-gray-700">Graph checks passed</h4>
          <p className="text-[11px] text-gray-500 max-w-xs mt-1">
            No cyclic dependencies, disconnected nodes, or missing triggers found.
          </p>
        </div>
      )}

      {/* Guide Footer */}
      <div className="p-3 border-t bg-gray-50 text-[10px] text-gray-500">
        <div className="flex items-start space-x-1.5">
          <Info className="h-3.5 w-3.5 text-gray-400 shrink-0 mt-0.5" />
          <span>
            Connect nodes by dragging between handles. Condition branches have dedicated True and False outputs.
          </span>
        </div>
      </div>
    </div>
  );
};

export default ValidationPanel;
