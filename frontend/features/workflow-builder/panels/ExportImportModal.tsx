import * as React from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Download, Upload, Copy, Check, FileJson, AlertCircle } from 'lucide-react';
import { useWorkflowBuilderStore } from '../stores/workflowBuilderStore';
import type { WorkflowDefinition } from '@/types/workflow';

interface ExportImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'export' | 'import';
}

export const ExportImportModal: React.FC<ExportImportModalProps> = ({
  isOpen,
  onClose,
  defaultTab = 'export',
}) => {
  const [activeTab, setActiveTab] = React.useState<'export' | 'import'>(defaultTab);
  const [copied, setCopied] = React.useState(false);
  const [importJson, setImportJson] = React.useState('');
  const [importError, setImportError] = React.useState<string | null>(null);

  const {
    workflowName,
    workflowId,
    currentVersion,
    publishedVersion,
    toBackendDefinition,
    loadFromBackendDefinition,
    isReadOnly,
  } = useWorkflowBuilderStore();

  React.useEffect(() => {
    setActiveTab(defaultTab);
    setImportError(null);
    setImportJson('');
  }, [defaultTab, isOpen]);

  const definition = toBackendDefinition();
  const exportData = {
    schemaVersion: '1.0.0',
    workflowName,
    exportedAt: new Date().toISOString(),
    definition,
  };

  const formattedJson = JSON.stringify(exportData, null, 2);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(formattedJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([formattedJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${workflowName.toLowerCase().replace(/\s+/g, '_')}_v${currentVersion}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        setImportJson(text);
        setImportError(null);
      } catch (err: any) {
        setImportError('Failed to read file: ' + err.message);
      }
    };
    reader.readAsText(file);
  };

  const handleApplyImport = () => {
    if (isReadOnly) {
      setImportError('Cannot import in read-only mode');
      return;
    }

    try {
      setImportError(null);
      const parsed = JSON.parse(importJson);

      let importedDefinition: WorkflowDefinition | null = null;
      let importedName = workflowName;

      if (parsed.definition && Array.isArray(parsed.definition.nodes)) {
        importedDefinition = parsed.definition;
        if (parsed.workflowName) importedName = parsed.workflowName;
      } else if (Array.isArray(parsed.nodes)) {
        importedDefinition = parsed as WorkflowDefinition;
      } else {
        throw new Error('Invalid workflow package. Must contain "nodes" and "edges" arrays.');
      }

      loadFromBackendDefinition(
        importedName,
        importedDefinition,
        workflowId,
        currentVersion,
        publishedVersion,
        false
      );

      onClose();
    } catch (err: any) {
      setImportError(err.message || 'Invalid JSON format');
    }
  };

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      title={activeTab === 'export' ? 'Export Workflow' : 'Import Workflow'}
      maxWidth="2xl"
    >
      <div className="space-y-4">
        {/* Tab Switcher */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab('export')}
            className={`px-4 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
              activeTab === 'export'
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <div className="flex items-center space-x-1.5">
              <Download className="h-3.5 w-3.5" />
              <span>Export Package</span>
            </div>
          </button>
          <button
            onClick={() => setActiveTab('import')}
            className={`px-4 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
              activeTab === 'import'
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <div className="flex items-center space-x-1.5">
              <Upload className="h-3.5 w-3.5" />
              <span>Import Package</span>
            </div>
          </button>
        </div>

        {activeTab === 'export' ? (
          <div className="space-y-3">
            <p className="text-xs text-gray-600">
              Export this workflow definition to share across workspaces or save as a backup.
            </p>
            <div className="relative">
              <textarea
                readOnly
                value={formattedJson}
                rows={12}
                className="w-full p-3 font-mono text-[11px] bg-gray-50 border rounded-lg text-gray-800 focus:outline-none"
              />
            </div>
            <div className="flex justify-end space-x-2">
              <Button variant="outline" size="sm" onClick={handleCopy} className="text-xs">
                {copied ? <Check className="h-3.5 w-3.5 mr-1 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                {copied ? 'Copied!' : 'Copy JSON'}
              </Button>
              <Button size="sm" onClick={handleDownload} className="text-xs">
                <Download className="h-3.5 w-3.5 mr-1" /> Download JSON
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-600">
              Paste a valid workflow JSON package or upload a definition file to import into the canvas.
            </p>

            <div className="flex items-center space-x-2">
              <input
                type="file"
                id="workflow-import-file"
                accept=".json,application/json"
                onChange={handleImportFile}
                disabled={isReadOnly}
                className="hidden"
              />
              <label
                htmlFor="workflow-import-file"
                className="cursor-pointer inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                <FileJson className="h-3.5 w-3.5 mr-1.5 text-primary" /> Choose .json File
              </label>
            </div>

            <textarea
              placeholder="Paste workflow JSON here..."
              value={importJson}
              onChange={(e) => {
                setImportJson(e.target.value);
                setImportError(null);
              }}
              disabled={isReadOnly}
              rows={10}
              className="w-full p-3 font-mono text-[11px] bg-white border rounded-lg text-gray-800 focus:ring-1 focus:ring-primary focus:outline-none"
            />

            {importError && (
              <div className="flex items-center space-x-1.5 text-xs text-destructive bg-rose-50 p-2.5 rounded-md border border-rose-200">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{importError}</span>
              </div>
            )}

            <div className="flex justify-end space-x-2 pt-2">
              <Button variant="outline" size="sm" onClick={onClose} className="text-xs">
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleApplyImport}
                disabled={!importJson.trim() || isReadOnly}
                className="text-xs"
              >
                <Upload className="h-3.5 w-3.5 mr-1" /> Import into Canvas
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ExportImportModal;
