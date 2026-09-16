import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Sliders,
  Trash2,
  AlertCircle,
  Copy,
  CheckCircle2,
} from 'lucide-react';
import { useWorkflowBuilderStore } from '../stores/workflowBuilderStore';
import {
  httpRequestConfigSchema,
  emailConfigSchema,
  databaseQueryConfigSchema,
  notificationConfigSchema,
  conditionConfigSchema,
  delayConfigSchema,
  logConfigSchema,
  webhookTriggerSchema,
  manualTriggerSchema,
  scheduleTriggerSchema,
  type HttpRequestFormValues,
  type EmailFormValues,
  type DatabaseQueryFormValues,
  type NotificationFormValues,
  type ConditionFormValues,
  type DelayFormValues,
  type LogFormValues,
  type WebhookTriggerFormValues,
  type ManualTriggerFormValues,
  type ScheduleTriggerFormValues,
} from '../schemas/nodeConfigSchemas';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export const PropertiesPanel: React.FC = () => {
  const {
    nodes,
    selectedNodeId,
    updateNodeConfig,
    updateNodeLabel,
    deleteNode,
    duplicateNode,
    isReadOnly,
  } = useWorkflowBuilderStore();

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  if (!selectedNode) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center text-gray-400 bg-white border-l border-gray-200 select-none">
        <Sliders className="h-8 w-8 mb-2 opacity-30 text-gray-500" />
        <h4 className="text-xs font-semibold text-gray-600">No Node Selected</h4>
        <p className="text-[11px] text-gray-400 mt-1 max-w-[200px]">
          Click any node on the canvas to configure its settings and parameters.
        </p>
      </div>
    );
  }

  const { data, id } = selectedNode;
  const nodeType = data.nodeType;

  return (
    <div className="flex h-full flex-col bg-white border-l border-gray-200 overflow-y-auto">
      {/* Header */}
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-gray-100 text-gray-600">
            {nodeType}
          </span>
          {!isReadOnly && (
            <div className="flex items-center space-x-1">
              <button
                onClick={() => duplicateNode(id)}
                className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-800"
                title="Duplicate"
                type="button"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => deleteNode(id)}
                className="p-1 hover:bg-destructive/10 rounded text-gray-500 hover:text-destructive"
                title="Delete"
                type="button"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Editable Label */}
        <div>
          <label className="text-[11px] font-medium text-gray-500">Node Label</label>
          <input
            type="text"
            value={data.label || ''}
            disabled={isReadOnly}
            onChange={(e) => updateNodeLabel(id, e.target.value)}
            className="w-full mt-0.5 px-2.5 py-1 text-xs font-semibold text-gray-900 border rounded-md focus:ring-1 focus:ring-primary focus:outline-none disabled:bg-gray-50"
          />
        </div>

        <div className="text-[10px] text-gray-400 font-mono">
          ID: <span className="text-gray-600">{id}</span>
        </div>
      </div>

      {/* Dynamic Properties Form */}
      <div className="p-3 flex-1 overflow-y-auto">
        <NodeConfigForm
          key={id}
          nodeId={id}
          nodeType={nodeType}
          config={data.config || {}}
          isReadOnly={isReadOnly}
          onUpdate={(cfg) => updateNodeConfig(id, cfg)}
        />
      </div>
    </div>
  );
};

interface FormProps {
  nodeId: string;
  nodeType: string;
  config: Record<string, unknown>;
  isReadOnly: boolean;
  onUpdate: (config: Record<string, unknown>) => void;
}

const NodeConfigForm: React.FC<FormProps> = ({ nodeType, config, isReadOnly, onUpdate }) => {
  if (nodeType === 'http_request') {
    return <HttpRequestForm config={config} isReadOnly={isReadOnly} onUpdate={onUpdate} />;
  }
  if (nodeType === 'email') {
    return <EmailForm config={config} isReadOnly={isReadOnly} onUpdate={onUpdate} />;
  }
  if (nodeType === 'database_query') {
    return <DatabaseQueryForm config={config} isReadOnly={isReadOnly} onUpdate={onUpdate} />;
  }
  if (nodeType === 'notification') {
    return <NotificationForm config={config} isReadOnly={isReadOnly} onUpdate={onUpdate} />;
  }
  if (nodeType === 'condition') {
    return <ConditionForm config={config} isReadOnly={isReadOnly} onUpdate={onUpdate} />;
  }
  if (nodeType === 'delay') {
    return <DelayForm config={config} isReadOnly={isReadOnly} onUpdate={onUpdate} />;
  }
  if (nodeType === 'log') {
    return <LogForm config={config} isReadOnly={isReadOnly} onUpdate={onUpdate} />;
  }
  if (nodeType === 'webhook_trigger' || nodeType === 'webhook') {
    return <WebhookTriggerForm config={config} isReadOnly={isReadOnly} onUpdate={onUpdate} />;
  }
  if (nodeType === 'manual_trigger') {
    return <ManualTriggerForm config={config} isReadOnly={isReadOnly} onUpdate={onUpdate} />;
  }
  if (nodeType === 'schedule_trigger') {
    return <ScheduleTriggerForm config={config} isReadOnly={isReadOnly} onUpdate={onUpdate} />;
  }

  return (
    <div className="text-xs text-gray-500 py-4 text-center">
      No additional configuration required for this step.
    </div>
  );
};

// HTTP Request Form
const HttpRequestForm: React.FC<{
  config: Record<string, unknown>;
  isReadOnly: boolean;
  onUpdate: (cfg: Record<string, unknown>) => void;
}> = ({ config, isReadOnly, onUpdate }) => {
  const { register, handleSubmit, formState: { errors } } = useForm<HttpRequestFormValues>({
    resolver: zodResolver(httpRequestConfigSchema),
    defaultValues: {
      url: (config.url as string) || '',
      method: (config.method as any) || 'GET',
      headers: (config.headers as string) || '',
      body: (config.body as string) || '',
      timeoutMs: (config.timeoutMs as number) || 5000,
      retryCount: (config.retryCount as number) || 0,
    },
  });

  const onChange = handleSubmit((data) => {
    onUpdate(data);
  });

  return (
    <form onChange={onChange} className="space-y-3 text-xs">
      <div>
        <label className="font-medium text-gray-700">HTTP Method</label>
        <select
          {...register('method')}
          disabled={isReadOnly}
          className="w-full mt-1 px-2 py-1.5 border rounded-md bg-white text-xs"
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
        </select>
      </div>

      <div>
        <label className="font-medium text-gray-700">Endpoint URL</label>
        <input
          {...register('url')}
          placeholder="https://api.example.com/resource"
          disabled={isReadOnly}
          className="w-full mt-1 px-2.5 py-1.5 border rounded-md text-xs font-mono"
        />
        {errors.url && <p className="text-rose-500 text-[11px] mt-0.5">{errors.url.message}</p>}
      </div>

      <div>
        <label className="font-medium text-gray-700">Headers (JSON)</label>
        <textarea
          {...register('headers')}
          placeholder={'{\n  "Authorization": "Bearer token"\n}'}
          disabled={isReadOnly}
          rows={3}
          className="w-full mt-1 px-2 py-1 border rounded-md font-mono text-[11px]"
        />
      </div>

      <div>
        <label className="font-medium text-gray-700">Request Body (JSON)</label>
        <textarea
          {...register('body')}
          placeholder={'{\n  "key": "value"\n}'}
          disabled={isReadOnly}
          rows={3}
          className="w-full mt-1 px-2 py-1 border rounded-md font-mono text-[11px]"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="font-medium text-gray-700">Timeout (ms)</label>
          <input
            type="number"
            {...register('timeoutMs')}
            disabled={isReadOnly}
            className="w-full mt-1 px-2 py-1 border rounded-md text-xs"
          />
        </div>
        <div>
          <label className="font-medium text-gray-700">Retries</label>
          <input
            type="number"
            {...register('retryCount')}
            disabled={isReadOnly}
            className="w-full mt-1 px-2 py-1 border rounded-md text-xs"
          />
        </div>
      </div>
    </form>
  );
};

// Email Form
const EmailForm: React.FC<{
  config: Record<string, unknown>;
  isReadOnly: boolean;
  onUpdate: (cfg: Record<string, unknown>) => void;
}> = ({ config, isReadOnly, onUpdate }) => {
  const { register, handleSubmit, formState: { errors } } = useForm<EmailFormValues>({
    resolver: zodResolver(emailConfigSchema),
    defaultValues: {
      recipient: (config.recipient as string) || '',
      subject: (config.subject as string) || '',
      message: (config.message as string) || '',
    },
  });

  const onChange = handleSubmit((data) => {
    onUpdate(data);
  });

  return (
    <form onChange={onChange} className="space-y-3 text-xs">
      <div>
        <label className="font-medium text-gray-700">Recipient Email</label>
        <input
          {...register('recipient')}
          placeholder="user@example.com"
          disabled={isReadOnly}
          className="w-full mt-1 px-2.5 py-1.5 border rounded-md text-xs"
        />
        {errors.recipient && <p className="text-rose-500 text-[11px] mt-0.5">{errors.recipient.message}</p>}
      </div>

      <div>
        <label className="font-medium text-gray-700">Subject</label>
        <input
          {...register('subject')}
          placeholder="Workflow execution report"
          disabled={isReadOnly}
          className="w-full mt-1 px-2.5 py-1.5 border rounded-md text-xs"
        />
        {errors.subject && <p className="text-rose-500 text-[11px] mt-0.5">{errors.subject.message}</p>}
      </div>

      <div>
        <label className="font-medium text-gray-700">Message Body</label>
        <textarea
          {...register('message')}
          placeholder="Enter email content..."
          disabled={isReadOnly}
          rows={4}
          className="w-full mt-1 px-2.5 py-1.5 border rounded-md text-xs"
        />
        {errors.message && <p className="text-rose-500 text-[11px] mt-0.5">{errors.message.message}</p>}
      </div>
    </form>
  );
};

// Database Query Form
const DatabaseQueryForm: React.FC<{
  config: Record<string, unknown>;
  isReadOnly: boolean;
  onUpdate: (cfg: Record<string, unknown>) => void;
}> = ({ config, isReadOnly, onUpdate }) => {
  const { register, handleSubmit, formState: { errors } } = useForm<DatabaseQueryFormValues>({
    resolver: zodResolver(databaseQueryConfigSchema),
    defaultValues: {
      database: (config.database as string) || 'default',
      query: (config.query as string) || '',
      parameters: (config.parameters as string) || '',
    },
  });

  const onChange = handleSubmit((data) => {
    onUpdate(data);
  });

  return (
    <form onChange={onChange} className="space-y-3 text-xs">
      <div>
        <label className="font-medium text-gray-700">Database Name</label>
        <input
          {...register('database')}
          placeholder="analytics_db"
          disabled={isReadOnly}
          className="w-full mt-1 px-2.5 py-1.5 border rounded-md text-xs"
        />
      </div>

      <div>
        <label className="font-medium text-gray-700">Query (SQL / MongoDB)</label>
        <textarea
          {...register('query')}
          placeholder="SELECT id, email FROM users WHERE active = true;"
          disabled={isReadOnly}
          rows={4}
          className="w-full mt-1 px-2.5 py-1.5 border rounded-md font-mono text-[11px]"
        />
        {errors.query && <p className="text-rose-500 text-[11px] mt-0.5">{errors.query.message}</p>}
      </div>
    </form>
  );
};

// Notification Form
const NotificationForm: React.FC<{
  config: Record<string, unknown>;
  isReadOnly: boolean;
  onUpdate: (cfg: Record<string, unknown>) => void;
}> = ({ config, isReadOnly, onUpdate }) => {
  const { register, handleSubmit, formState: { errors } } = useForm<NotificationFormValues>({
    resolver: zodResolver(notificationConfigSchema),
    defaultValues: {
      channel: (config.channel as any) || 'in_app',
      recipient: (config.recipient as string) || '',
      message: (config.message as string) || '',
      level: (config.level as any) || 'info',
    },
  });

  const onChange = handleSubmit((data) => {
    onUpdate(data);
  });

  return (
    <form onChange={onChange} className="space-y-3 text-xs">
      <div>
        <label className="font-medium text-gray-700">Channel</label>
        <select
          {...register('channel')}
          disabled={isReadOnly}
          className="w-full mt-1 px-2 py-1.5 border rounded-md bg-white text-xs"
        >
          <option value="in_app">In-App</option>
          <option value="slack">Slack</option>
          <option value="email">Email</option>
          <option value="webhook">Webhook</option>
        </select>
      </div>

      <div>
        <label className="font-medium text-gray-700">Recipient / Target</label>
        <input
          {...register('recipient')}
          placeholder="#alerts or channel id"
          disabled={isReadOnly}
          className="w-full mt-1 px-2.5 py-1.5 border rounded-md text-xs"
        />
      </div>

      <div>
        <label className="font-medium text-gray-700">Alert Level</label>
        <select
          {...register('level')}
          disabled={isReadOnly}
          className="w-full mt-1 px-2 py-1.5 border rounded-md bg-white text-xs"
        >
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
        </select>
      </div>

      <div>
        <label className="font-medium text-gray-700">Message</label>
        <textarea
          {...register('message')}
          placeholder="Workflow execution finished."
          disabled={isReadOnly}
          rows={3}
          className="w-full mt-1 px-2.5 py-1.5 border rounded-md text-xs"
        />
        {errors.message && <p className="text-rose-500 text-[11px] mt-0.5">{errors.message.message}</p>}
      </div>
    </form>
  );
};

// Condition Form
const ConditionForm: React.FC<{
  config: Record<string, unknown>;
  isReadOnly: boolean;
  onUpdate: (cfg: Record<string, unknown>) => void;
}> = ({ config, isReadOnly, onUpdate }) => {
  const { register, handleSubmit, formState: { errors } } = useForm<ConditionFormValues>({
    resolver: zodResolver(conditionConfigSchema),
    defaultValues: {
      field: (config.field as string) || 'input.status',
      operator: (config.operator as any) || 'equals',
      value: config.value !== undefined ? String(config.value) : 'success',
    },
  });

  const onChange = handleSubmit((data) => {
    onUpdate(data);
  });

  return (
    <form onChange={onChange} className="space-y-3 text-xs">
      <div>
        <label className="font-medium text-gray-700">Target Field</label>
        <input
          {...register('field')}
          placeholder="input.status or user.role"
          disabled={isReadOnly}
          className="w-full mt-1 px-2.5 py-1.5 border rounded-md font-mono text-xs"
        />
        {errors.field && <p className="text-rose-500 text-[11px] mt-0.5">{errors.field.message}</p>}
      </div>

      <div>
        <label className="font-medium text-gray-700">Operator</label>
        <select
          {...register('operator')}
          disabled={isReadOnly}
          className="w-full mt-1 px-2 py-1.5 border rounded-md bg-white text-xs"
        >
          <option value="equals">equals (==)</option>
          <option value="notEquals">not equals (!=)</option>
          <option value="greaterThan">greater than (&gt;)</option>
          <option value="lessThan">less than (&lt;)</option>
        </select>
      </div>

      <div>
        <label className="font-medium text-gray-700">Expected Value</label>
        <input
          {...register('value')}
          placeholder="success or 100"
          disabled={isReadOnly}
          className="w-full mt-1 px-2.5 py-1.5 border rounded-md text-xs font-mono"
        />
        {errors.value && <p className="text-rose-500 text-[11px] mt-0.5">{String(errors.value.message)}</p>}
      </div>

      <div className="p-2 bg-amber-50 rounded text-[11px] text-amber-800 border border-amber-200">
        Connect the <span className="font-bold text-emerald-600">True</span> handle for matching conditions and <span className="font-bold text-rose-600">False</span> for non-matching.
      </div>
    </form>
  );
};

// Delay Form
const DelayForm: React.FC<{
  config: Record<string, unknown>;
  isReadOnly: boolean;
  onUpdate: (cfg: Record<string, unknown>) => void;
}> = ({ config, isReadOnly, onUpdate }) => {
  const { register, handleSubmit, formState: { errors } } = useForm<DelayFormValues>({
    resolver: zodResolver(delayConfigSchema),
    defaultValues: {
      durationSeconds: (config.durationSeconds as number) || 5,
      mode: (config.mode as any) || 'fixed',
    },
  });

  const onChange = handleSubmit((data) => {
    onUpdate(data);
  });

  return (
    <form onChange={onChange} className="space-y-3 text-xs">
      <div>
        <label className="font-medium text-gray-700">Duration (Seconds)</label>
        <input
          type="number"
          {...register('durationSeconds')}
          disabled={isReadOnly}
          className="w-full mt-1 px-2.5 py-1.5 border rounded-md text-xs font-mono"
        />
        {errors.durationSeconds && (
          <p className="text-rose-500 text-[11px] mt-0.5">{errors.durationSeconds.message}</p>
        )}
      </div>

      <div>
        <label className="font-medium text-gray-700">Mode</label>
        <select
          {...register('mode')}
          disabled={isReadOnly}
          className="w-full mt-1 px-2 py-1.5 border rounded-md bg-white text-xs"
        >
          <option value="fixed">Fixed Duration</option>
          <option value="dynamic">Dynamic from payload</option>
        </select>
      </div>
    </form>
  );
};

// Log Form
const LogForm: React.FC<{
  config: Record<string, unknown>;
  isReadOnly: boolean;
  onUpdate: (cfg: Record<string, unknown>) => void;
}> = ({ config, isReadOnly, onUpdate }) => {
  const { register, handleSubmit, formState: { errors } } = useForm<LogFormValues>({
    resolver: zodResolver(logConfigSchema),
    defaultValues: {
      message: (config.message as string) || 'Execution checkpoint reached',
      level: (config.level as any) || 'info',
    },
  });

  const onChange = handleSubmit((data) => {
    onUpdate(data);
  });

  return (
    <form onChange={onChange} className="space-y-3 text-xs">
      <div>
        <label className="font-medium text-gray-700">Log Message</label>
        <textarea
          {...register('message')}
          placeholder="Workflow status: payload received"
          disabled={isReadOnly}
          rows={3}
          className="w-full mt-1 px-2.5 py-1.5 border rounded-md text-xs font-mono"
        />
        {errors.message && <p className="text-rose-500 text-[11px] mt-0.5">{errors.message.message}</p>}
      </div>

      <div>
        <label className="font-medium text-gray-700">Level</label>
        <select
          {...register('level')}
          disabled={isReadOnly}
          className="w-full mt-1 px-2 py-1.5 border rounded-md bg-white text-xs"
        >
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
          <option value="debug">Debug</option>
        </select>
      </div>
    </form>
  );
};

// Webhook Trigger Form
const WebhookTriggerForm: React.FC<{
  config: Record<string, unknown>;
  isReadOnly: boolean;
  onUpdate: (cfg: Record<string, unknown>) => void;
}> = ({ config, isReadOnly, onUpdate }) => {
  const { register, handleSubmit } = useForm<WebhookTriggerFormValues>({
    resolver: zodResolver(webhookTriggerSchema),
    defaultValues: {
      method: (config.method as any) || 'POST',
      path: (config.path as string) || '/webhook',
      authRequired: (config.authRequired as boolean) || false,
    },
  });

  const onChange = handleSubmit((data) => {
    onUpdate(data);
  });

  return (
    <form onChange={onChange} className="space-y-3 text-xs">
      <div>
        <label className="font-medium text-gray-700">HTTP Method</label>
        <select
          {...register('method')}
          disabled={isReadOnly}
          className="w-full mt-1 px-2 py-1.5 border rounded-md bg-white text-xs"
        >
          <option value="POST">POST</option>
          <option value="GET">GET</option>
          <option value="PUT">PUT</option>
        </select>
      </div>

      <div>
        <label className="font-medium text-gray-700">Webhook Path</label>
        <input
          {...register('path')}
          placeholder="/webhook"
          disabled={isReadOnly}
          className="w-full mt-1 px-2.5 py-1.5 border rounded-md font-mono text-xs"
        />
      </div>

      <div className="flex items-center space-x-2 pt-1">
        <input
          type="checkbox"
          id="authRequired"
          {...register('authRequired')}
          disabled={isReadOnly}
          className="h-3.5 w-3.5 rounded border-gray-300 text-primary"
        />
        <label htmlFor="authRequired" className="font-medium text-gray-700">
          Require API Key / Signature
        </label>
      </div>
    </form>
  );
};

// Manual Trigger Form
const ManualTriggerForm: React.FC<{
  config: Record<string, unknown>;
  isReadOnly: boolean;
  onUpdate: (cfg: Record<string, unknown>) => void;
}> = ({ config, isReadOnly, onUpdate }) => {
  const { register, handleSubmit } = useForm<ManualTriggerFormValues>({
    resolver: zodResolver(manualTriggerSchema),
    defaultValues: {
      description: (config.description as string) || '',
      inputSchema: (config.inputSchema as string) || '',
    },
  });

  const onChange = handleSubmit((data) => {
    onUpdate(data);
  });

  return (
    <form onChange={onChange} className="space-y-3 text-xs">
      <div>
        <label className="font-medium text-gray-700">Trigger Description</label>
        <input
          {...register('description')}
          placeholder="Manual test execution"
          disabled={isReadOnly}
          className="w-full mt-1 px-2.5 py-1.5 border rounded-md text-xs"
        />
      </div>

      <div>
        <label className="font-medium text-gray-700">Input Schema (JSON Schema)</label>
        <textarea
          {...register('inputSchema')}
          placeholder={'{\n  "type": "object",\n  "properties": {}\n}'}
          disabled={isReadOnly}
          rows={4}
          className="w-full mt-1 px-2.5 py-1.5 border rounded-md font-mono text-[11px]"
        />
      </div>
    </form>
  );
};

// Schedule Trigger Form
const ScheduleTriggerForm: React.FC<{
  config: Record<string, unknown>;
  isReadOnly: boolean;
  onUpdate: (cfg: Record<string, unknown>) => void;
}> = ({ config, isReadOnly, onUpdate }) => {
  const { register, handleSubmit, formState: { errors } } = useForm<ScheduleTriggerFormValues>({
    resolver: zodResolver(scheduleTriggerSchema),
    defaultValues: {
      cronExpression: (config.cronExpression as string) || '0 * * * *',
      timezone: (config.timezone as string) || 'UTC',
    },
  });

  const onChange = handleSubmit((data) => {
    onUpdate(data);
  });

  return (
    <form onChange={onChange} className="space-y-3 text-xs">
      <div>
        <label className="font-medium text-gray-700">Cron Expression</label>
        <input
          {...register('cronExpression')}
          placeholder="0 * * * * (Hourly)"
          disabled={isReadOnly}
          className="w-full mt-1 px-2.5 py-1.5 border rounded-md font-mono text-xs"
        />
        {errors.cronExpression && (
          <p className="text-rose-500 text-[11px] mt-0.5">{errors.cronExpression.message}</p>
        )}
      </div>

      <div>
        <label className="font-medium text-gray-700">Timezone</label>
        <input
          {...register('timezone')}
          placeholder="UTC or America/New_York"
          disabled={isReadOnly}
          className="w-full mt-1 px-2.5 py-1.5 border rounded-md text-xs"
        />
      </div>
    </form>
  );
};

export default PropertiesPanel;
