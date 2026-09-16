'use client';

import * as React from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useRouter } from 'next/navigation';
import { nodeTypes } from '../nodes/nodeTypes';
import { edgeTypes } from '../edges/edgeTypes';
import { useWorkflowBuilderStore } from '../stores/workflowBuilderStore';
import { NodePalette } from '../panels/NodePalette';
import { PropertiesPanel } from '../panels/PropertiesPanel';
import { ValidationPanel } from '../panels/ValidationPanel';
import { WorkflowToolbar } from '../panels/WorkflowToolbar';
import { workflowApi } from '@/services/workflowApi';
import type { BuilderNodeType } from '../types/workflowBuilder';
import { Sliders, ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react';

interface WorkflowCanvasProps {
  workflowId?: string;
  workflowName?: string;
  setWorkflowName?: (name: string) => void;
  currentVersion?: number;
  publishedVersion?: number | null;
}

const WorkflowCanvasInner: React.FC<WorkflowCanvasProps> = ({
  workflowId: propWorkflowId,
}) => {
  const router = useRouter();
  const reactFlowWrapper = React.useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();

  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    setSelectedNodeId,
    workflowId: storeWorkflowId,
    setWorkflowId,
    workflowName,
    setWorkflowName,
    currentVersion,
    publishedVersion,
    isReadOnly,
    setIsReadOnly,
    validationErrors,
    validateGraphLocally,
    setBackendValidationErrors,
    toBackendDefinition,
    loadFromBackendDefinition,
  } = useWorkflowBuilderStore();

  const [activeRightTab, setActiveRightTab] = React.useState<'properties' | 'validation'>('properties');
  const [isSaving, setIsSaving] = React.useState(false);
  const [isValidating, setIsValidating] = React.useState(false);
  const [isPublishing, setIsPublishing] = React.useState(false);
  const [notification, setNotification] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Auto clear notification after 4s
  React.useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Handle initial trigger node for brand new workflow if empty
  React.useEffect(() => {
    if (!propWorkflowId && nodes.length === 0) {
      addNode('manual_trigger', { x: 250, y: 80 }, { description: 'Start workflow execution' });
    }
  }, [propWorkflowId, nodes.length, addNode]);

  // Drag and Drop handlers
  const onDragOver = React.useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = React.useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow/type') as BuilderNodeType;
      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode = addNode(type, position);
      setSelectedNodeId(newNode.id);
      setActiveRightTab('properties');
    },
    [screenToFlowPosition, addNode, setSelectedNodeId]
  );

  // Save Draft Action
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const definition = toBackendDefinition();
      const currentId = propWorkflowId || storeWorkflowId;

      if (currentId) {
        // Update existing workflow draft
        await workflowApi.updateDraft(currentId, {
          name: workflowName,
          definition,
        });
        setNotification({ type: 'success', message: 'Workflow draft saved successfully' });
      } else {
        // Create new workflow
        const created = await workflowApi.createWorkflow({
          name: workflowName,
          definition,
        });
        setWorkflowId(created.id || (created as any)._id || null);
        setNotification({ type: 'success', message: 'Workflow created successfully' });
        router.replace(`/workflows/${created.id || (created as any)._id}/edit`);
      }
    } catch (err: any) {
      setNotification({
        type: 'error',
        message: err?.response?.data?.message || err.message || 'Failed to save workflow',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Validate Action
  const handleValidate = async () => {
    setIsValidating(true);
    try {
      // Run local graph validation
      const localErrors = validateGraphLocally();
      const currentId = propWorkflowId || storeWorkflowId;

      if (currentId) {
        // Run backend validation endpoint
        const backendResult = await workflowApi.validateDraft(currentId);
        if (!backendResult.valid && backendResult.errors) {
          setBackendValidationErrors(
            backendResult.errors.map((e) => ({
              type: 'BACKEND_VALIDATION_ERROR',
              message: typeof e === 'string' ? e : (e as any).message || 'Validation error',
              severity: 'error',
            }))
          );
        }
      }

      setActiveRightTab('validation');
      if (localErrors.length === 0) {
        setNotification({ type: 'success', message: 'Workflow graph is valid!' });
      } else {
        setNotification({ type: 'error', message: `Found ${localErrors.length} validation issue(s)` });
      }
    } catch (err: any) {
      setNotification({
        type: 'error',
        message: err?.response?.data?.message || err.message || 'Validation failed',
      });
    } finally {
      setIsValidating(false);
    }
  };

  // Publish Action
  const handlePublish = async () => {
    const currentId = propWorkflowId || storeWorkflowId;
    if (!currentId) {
      setNotification({ type: 'error', message: 'Please save the workflow before publishing' });
      return;
    }

    const localErrors = validateGraphLocally();
    if (localErrors.length > 0) {
      setActiveRightTab('validation');
      setNotification({ type: 'error', message: 'Cannot publish workflow with validation errors' });
      return;
    }

    setIsPublishing(true);
    try {
      // First save draft
      await workflowApi.updateDraft(currentId, {
        name: workflowName,
        definition: toBackendDefinition(),
      });

      // Then publish
      await workflowApi.publishWorkflow(currentId);
      setNotification({ type: 'success', message: 'Workflow version published successfully!' });
    } catch (err: any) {
      setNotification({
        type: 'error',
        message: err?.response?.data?.message || err.message || 'Failed to publish workflow',
      });
    } finally {
      setIsPublishing(false);
    }
  };

  const errorCount = validationErrors.length;

  return (
    <div className="flex h-screen flex-col bg-gray-50 overflow-hidden">
      {/* Top Toolbar */}
      <WorkflowToolbar
        onSave={handleSave}
        onPublish={handlePublish}
        onValidate={handleValidate}
        isSaving={isSaving}
        isValidating={isValidating}
        isPublishing={isPublishing}
      />

      {/* Notification Toast */}
      {notification && (
        <div
          className={`fixed top-16 right-6 z-50 flex items-center space-x-2 px-4 py-2.5 rounded-lg shadow-lg border text-xs font-medium transition-all ${
            notification.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 shadow-emerald-100'
              : 'bg-rose-50 text-rose-800 border-rose-200 shadow-rose-100'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
          )}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Main Workspace */}
      <div className="flex flex-1 min-h-0 relative">
        {/* Left: Node Palette */}
        <div className="w-64 h-full shrink-0">
          <NodePalette />
        </div>

        {/* Center: React Flow Canvas */}
        <div
          ref={reactFlowWrapper}
          className="flex-1 h-full relative bg-slate-50/50"
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id);
              setActiveRightTab('properties');
            }}
            onPaneClick={() => setSelectedNodeId(null)}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            snapToGrid
            snapGrid={[15, 15]}
            defaultEdgeOptions={{
              type: 'conditionEdge',
              animated: false,
            }}
            className="w-full h-full"
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#cbd5e1" />
            <Controls className="!bg-white !border-gray-200 !shadow-sm !rounded-lg" />
            <MiniMap
              className="!border !border-gray-200 !bg-white/90 !rounded-lg !shadow-xs"
              zoomable
              pannable
              nodeColor={(node) => {
                const cat = (node.data as any)?.category;
                if (cat === 'trigger') return '#8b5cf6';
                if (cat === 'logic') return '#f59e0b';
                if (cat === 'marketplace') return '#ec4899';
                return '#3b82f6';
              }}
            />
          </ReactFlow>
        </div>

        {/* Right: Properties & Validation Panel */}
        <div className="w-80 h-full shrink-0 flex flex-col bg-white border-l border-gray-200">
          {/* Tab Header */}
          <div className="flex border-b border-gray-200 bg-gray-50/50 shrink-0">
            <button
              onClick={() => setActiveRightTab('properties')}
              className={`flex-1 py-2 px-3 text-xs font-semibold flex items-center justify-center space-x-1.5 border-b-2 transition-colors ${
                activeRightTab === 'properties'
                  ? 'border-primary text-primary bg-white'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'
              }`}
            >
              <Sliders className="h-3.5 w-3.5" />
              <span>Properties</span>
            </button>
            <button
              onClick={() => setActiveRightTab('validation')}
              className={`flex-1 py-2 px-3 text-xs font-semibold flex items-center justify-center space-x-1.5 border-b-2 transition-colors ${
                activeRightTab === 'validation'
                  ? 'border-primary text-primary bg-white'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Validation</span>
              {errorCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 ml-1">
                  {errorCount}
                </span>
              )}
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {activeRightTab === 'properties' ? <PropertiesPanel /> : <ValidationPanel />}
          </div>
        </div>
      </div>
    </div>
  );
};

export const WorkflowCanvas: React.FC<WorkflowCanvasProps> = (props) => {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
};

export default WorkflowCanvas;
