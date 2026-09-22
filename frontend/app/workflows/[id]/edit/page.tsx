'use client';

import * as React from 'react';
import { WorkflowCanvas } from '@/features/workflow-builder/canvas/WorkflowCanvas';
import { useParams, notFound } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useWorkflowBuilderStore } from '@/features/workflow-builder/stores/workflowBuilderStore';
import { workflowApi } from '@/services/workflowApi';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { hasPermission } from '@/types/permissions';
import { useWorkspaceHydration } from '@/hooks/useWorkspaceHydration';

export default function EditWorkflowPage() {
  const params = useParams<{ id: string }>();
  const workflowId = params?.id;

  if (!workflowId) {
    notFound();
  }

  const [loading, setLoading] = useState(true);
  const hydrated = useWorkspaceHydration();
  const { currentRole } = useWorkspaceStore();
  const { loadFromBackendDefinition, setIsReadOnly } = useWorkflowBuilderStore();

  useEffect(() => {
    if (!workflowId || !hydrated) return;

    let isMounted = true;

    const loadWorkflow = async () => {
      try {
        const canView =
          hasPermission(currentRole, 'WORKFLOW_READ') ||
          hasPermission(currentRole, 'WORKFLOW_UPDATE') ||
          hasPermission(currentRole, 'WORKFLOW_CREATE');

        if (!canView) {
          if (isMounted) notFound();
          return;
        }

        const canEdit = hasPermission(currentRole, 'WORKFLOW_UPDATE');
        const workflow = await workflowApi.getWorkflow(workflowId);

        if (isMounted) {
          const isWorkflowReadOnly = !canEdit;
          setIsReadOnly(isWorkflowReadOnly);
          loadFromBackendDefinition(
            workflow.name,
            workflow.draft?.definition || workflow.definition,
            workflow.id || workflow._id,
            workflow.currentVersion,
            workflow.publishedVersion ??
              (workflow.publishedVersionId || workflow.status === 'PUBLISHED'
                ? workflow.latestVersionNumber ?? workflow.currentVersion ?? null
                : null),
            isWorkflowReadOnly
          );
          setLoading(false);
        }
      } catch (error) {
        if (isMounted) {
          notFound();
        }
      }
    };

    loadWorkflow();

    return () => {
      isMounted = false;
    };
  }, [workflowId, hydrated, loadFromBackendDefinition, setIsReadOnly, currentRole]);

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return <WorkflowCanvas workflowId={workflowId} />;
}
