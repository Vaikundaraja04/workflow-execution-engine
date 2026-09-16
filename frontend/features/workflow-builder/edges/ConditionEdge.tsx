import * as React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';
import { X } from 'lucide-react';
import { useWorkflowBuilderStore } from '../stores/workflowBuilderStore';

export const ConditionEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  label,
  sourceHandleId,
  selected,
}) => {
  const { deleteEdge, isReadOnly } = useWorkflowBuilderStore();

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  const conditionType = sourceHandleId === 'true' || label === 'true' ? 'true' : sourceHandleId === 'false' || label === 'false' ? 'false' : null;

  let strokeColor = '#94a3b8'; // slate-400
  let badgeColor = 'bg-slate-100 text-slate-700 border-slate-300';

  if (conditionType === 'true') {
    strokeColor = '#10b981'; // emerald-500
    badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-300';
  } else if (conditionType === 'false') {
    strokeColor = '#ef4444'; // red-500
    badgeColor = 'bg-rose-50 text-rose-700 border-rose-300';
  }

  const customStyle: React.CSSProperties = {
    ...style,
    stroke: selected ? '#3b82f6' : strokeColor,
    strokeWidth: selected ? 2.5 : 2,
  };

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={customStyle} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan flex items-center space-x-1 group"
        >
          {conditionType && (
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold border shadow-xs transition-transform group-hover:scale-105 ${badgeColor}`}
            >
              {conditionType.toUpperCase()}
            </span>
          )}
          {!isReadOnly && selected && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteEdge(id);
              }}
              className="h-4 w-4 rounded-full bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600 shadow-xs transition-colors"
              title="Delete Connection"
              type="button"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

export default ConditionEdge;
