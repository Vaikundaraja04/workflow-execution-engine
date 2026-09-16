import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Save,
  Upload,
  CheckCircle,
  Undo2,
  Redo2,
  History,
  Download,
  FileCode,
  Lock,
  ArrowLeft,
  Share2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useWorkflowBuilderStore } from '../stores/workflowBuilderStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { hasPermission } from '@/types/permissions';
import { workflowApi } from '@/services/workflowApi';
import { ExportImportModal } from './ExportImportModal';
import { Modal } from '@/components/ui/Modal';

interface WorkflowToolbarProps {
  onSave?: () => Promise<void>;
  onPublish?: () => Promise<void>;
  onValidate?: () => Promise<void>;
  isSaving?: boolean;
  isValidating?: boolean;
  isPublishing?: boolean;
}

export const WorkflowToolbar: React.FC<WorkflowToolbarProps> = ({
  onSave,
  onPublish,
  onValidate,
  isSaving: propIsSaving,
  isValidating: propIsValidating,
  isPublishing: propIsPublishing,
}) => {
  const router = useRouter();
  const { currentRole } = useWorkspaceStore();
  const {
    workflowId,
    workflowName,
    setWorkflowName,
    currentVersion,
    publishedVersion,
    isDirty,
    isReadOnly,
    undo,
    redo,
    past,
    future,
    validationErrors,
    isSaving: storeIsSaving,
    isPublishing: storeIsPublishing,
    isValidating: storeIsValidating,
  } = useWorkflowBuilderStore();

  const [isExportModalOpen, setIsExportModalOpen] = React.useState(false);
  const [exportDefaultTab, setExportDefaultTab] = React.useState<'export' | 'import'>('export');
  const [isPublishModalOpen, setIsPublishModalOpen] = React.useState(false);
  const [changeSummary, setChangeSummary] = React.useState('');

  const canEdit = hasPermission(currentRole, 'WORKFLOW_UPDATE') || hasPermission(currentRole, 'WORKFLOW_CREATE');
  const canPublish = hasPermission(currentRole, 'WORKFLOW_UPDATE');

  const saving = propIsSaving ?? storeIsSaving;
  const validating = propIsValidating ?? storeIsValidating;
  const publishing = propIsPublishing ?? storeIsPublishing;

  const handleOpenExport = (tab: 'export' | 'import') => {
    setExportDefaultTab(tab);
    setIsExportModalOpen(true);
  };

  const handlePublishSubmit = async () => {
    if (onPublish) {
      await onPublish();
      setIsPublishModalOpen(false);
      setChangeSummary('');
    }
  };

  return (
    <>
      <header className="h-14 border-b border-gray-200 bg-white px-4 flex items-center justify-between shrink-0 select-none z-10">
        {/* Left: Back & Name */}
        <div className="flex items-center space-x-3">
          <Link
            href="/dashboard"
            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-900 transition-colors"
            title="Back to Dashboard"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>

          <div className="flex items-center space-x-2">
            <input
              type="text"
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              disabled={isReadOnly || !canEdit}
              placeholder="Workflow Name"
              className="text-sm font-semibold text-gray-900 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-primary focus:outline-none px-1 py-0.5 max-w-[240px] truncate"
            />

            {/* Version & Status Badge */}
            <div className="flex items-center space-x-1.5">
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                v{currentVersion} {publishedVersion === currentVersion ? '(Published)' : '(Draft)'}
              </span>
              {isDirty && !isReadOnly && (
                <span className="h-2 w-2 rounded-full bg-amber-500" title="Unsaved changes" />
              )}
            </div>

            {isReadOnly && (
              <span className="flex items-center space-x-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                <Lock className="h-3 w-3" />
                <span>Read-Only</span>
              </span>
            )}
          </div>
        </div>

        {/* Center: Undo / Redo */}
        {!isReadOnly && (
          <div className="hidden md:flex items-center space-x-1 bg-gray-50 p-1 rounded-lg border border-gray-200">
            <button
              onClick={undo}
              disabled={past.length === 0}
              className="p-1 rounded hover:bg-white text-gray-600 disabled:opacity-30 disabled:hover:bg-transparent"
              title="Undo (Ctrl+Z)"
              type="button"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              onClick={redo}
              disabled={future.length === 0}
              className="p-1 rounded hover:bg-white text-gray-600 disabled:opacity-30 disabled:hover:bg-transparent"
              title="Redo (Ctrl+Y)"
              type="button"
            >
              <Redo2 className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Right: Actions */}
        <div className="flex items-center space-x-2">
          {/* Version History Link */}
          {workflowId && (
            <Link
              href={`/workflows/${workflowId}/versions`}
              className="inline-flex items-center px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-700 hover:bg-gray-100 border border-gray-200 transition-colors"
              title="Version History"
            >
              <History className="h-3.5 w-3.5 mr-1 text-gray-500" />
              <span className="hidden sm:inline">Versions</span>
            </Link>
          )}

          {/* Import / Export */}
          <div className="flex items-center border border-gray-200 rounded-md overflow-hidden">
            <button
              onClick={() => handleOpenExport('export')}
              className="px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-gray-900 border-r border-gray-200"
              title="Export JSON"
              type="button"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            {!isReadOnly && canEdit && (
              <button
                onClick={() => handleOpenExport('import')}
                className="px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                title="Import JSON"
                type="button"
              >
                <Upload className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Validate Button */}
          {onValidate && (
            <Button
              variant="outline"
              size="sm"
              onClick={onValidate}
              disabled={validating}
              className="text-xs h-8"
            >
              <CheckCircle className="h-3.5 w-3.5 mr-1" />
              <span className="hidden sm:inline">Validate</span>
            </Button>
          )}

          {/* Save Draft Button (Only if canEdit and not read-only) */}
          {!isReadOnly && canEdit && onSave && (
            <Button
              variant="outline"
              size="sm"
              onClick={onSave}
              disabled={saving}
              className="text-xs h-8"
            >
              <Save className="h-3.5 w-3.5 mr-1" />
              <span>{saving ? 'Saving...' : 'Save Draft'}</span>
            </Button>
          )}

          {/* Publish Button (Only if canPublish and not read-only) */}
          {!isReadOnly && canPublish && onPublish && (
            <Button
              size="sm"
              onClick={() => setIsPublishModalOpen(true)}
              disabled={publishing || validationErrors.length > 0}
              className="text-xs h-8 bg-primary hover:bg-primary/90"
            >
              <Share2 className="h-3.5 w-3.5 mr-1" />
              <span>{publishing ? 'Publishing...' : 'Publish'}</span>
            </Button>
          )}
        </div>
      </header>

      {/* Export / Import Modal */}
      <ExportImportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        defaultTab={exportDefaultTab}
      />

      {/* Publish Change Summary Modal */}
      <Modal
        open={isPublishModalOpen}
        onOpenChange={(open) => !open && setIsPublishModalOpen(false)}
        title="Publish Workflow Version"
        maxWidth="md"
      >
        <div className="space-y-3">
          <p className="text-xs text-gray-600">
            Publishing will increment the workflow version and make this definition the active version for executions.
          </p>

          <div>
            <label className="text-xs font-medium text-gray-700">Change Summary (optional)</label>
            <textarea
              value={changeSummary}
              onChange={(e) => setChangeSummary(e.target.value)}
              placeholder="e.g. Added error handling step and updated retry policy"
              rows={3}
              maxLength={280}
              className="w-full mt-1 p-2 border rounded-md text-xs focus:ring-1 focus:ring-primary focus:outline-none"
            />
            <span className="text-[10px] text-gray-400 text-right block mt-0.5">
              {changeSummary.length}/280
            </span>
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsPublishModalOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handlePublishSubmit}
              disabled={publishing}
              className="text-xs"
            >
              {publishing ? 'Publishing...' : 'Confirm Publish'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default WorkflowToolbar;
