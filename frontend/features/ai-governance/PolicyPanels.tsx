'use client';

import * as React from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { aiGovernancePolicyApi } from '@/services/aiGovernanceApi';
import { hasPermission } from '@/types/permissions';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import {
  GOVERNANCE_FEATURES,
  PII_DATA_CLASSES,
  type AIApprovalPolicyDTO,
  type AIFeaturePolicyDTO,
  type AIModelAccessPolicyDTO,
  type AIPrivacyPolicyDTO,
  type AIPromptPolicyDTO,
  type AIUsageLimitPolicyDTO,
  type AgentToolPolicyDTO,
  type GovernanceFeature,
  type GovernancePolicyDTO,
  type GovernancePolicyType,
  type PIIDataClass,
} from '@/types/aiGovernancePolicy';
import type { WorkspaceRole } from '@/types/workspace';

const ROLES: WorkspaceRole[] = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'];

function workspaceIdOf(workspace: { _id?: string; id?: string } | null | undefined): string {
  if (!workspace) return '';
  return workspace._id ?? workspace.id ?? '';
}

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function useGovernancePolicies(type: GovernancePolicyType) {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = workspaceIdOf(currentWorkspace);
  const [policies, setPolicies] = React.useState<GovernancePolicyDTO[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    try {
      setLoading(true);
      setPolicies(await aiGovernancePolicyApi.listPolicies(type, workspaceId || undefined));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load policies');
    } finally {
      setLoading(false);
    }
  }, [type, workspaceId]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  return { workspaceId, policies, loading, error, reload };
}
interface PanelShellProps {
  title: string;
  description?: string;
  canManage: boolean;
  saving: boolean;
  onSave: () => void;
  children: React.ReactNode;
}

function PanelShell({ title, description, canManage, saving, onSave, children }: PanelShellProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {!canManage ? (
            <Badge variant="outline" size="sm">
              read only
            </Badge>
          ) : null}
          <Button size="sm" onClick={onSave} disabled={!canManage || saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">{children}</CardContent>
    </Card>
  );
}

const inputClass =
  'w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900';

function TextArea({
  value,
  onChange,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      rows={3}
      className={inputClass}
    />
  );
}

function NumberInput({
  value,
  onChange,
  disabled,
  step = '1',
}: {
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
  step?: string;
}) {
  return (
    <input
      type="number"
      min={0}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
      className={inputClass}
    />
  );
}

function CheckRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}
export function ModelAccessPolicyPanel() {
  const { currentRole } = useWorkspaceStore();
  const canManage = hasPermission(currentRole, 'AI_GOVERNANCE_MANAGE');
  const { workspaceId, policies, reload } = useGovernancePolicies('MODEL_ACCESS');
  const existing = (policies[0] as AIModelAccessPolicyDTO | undefined) ?? null;

  const [allowedModels, setAllowedModels] = React.useState('');
  const [blockedModels, setBlockedModels] = React.useState('');
  const [allowedRoles, setAllowedRoles] = React.useState<WorkspaceRole[]>([]);
  const [status, setStatus] = React.useState<'ACTIVE' | 'DISABLED'>('ACTIVE');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!existing) return;
    setAllowedModels(existing.allowedModels.join('\n'));
    setBlockedModels(existing.blockedModels.join('\n'));
    setAllowedRoles(existing.allowedRoles ?? []);
    setStatus(existing.status ?? 'ACTIVE');
  }, [existing]);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        allowedModels: splitLines(allowedModels),
        blockedModels: splitLines(blockedModels),
        allowedRoles,
        status,
      };
      if (existing?._id) {
        await aiGovernancePolicyApi.updatePolicy(existing._id, payload, workspaceId);
      } else {
        await aiGovernancePolicyApi.createPolicy({ type: 'MODEL_ACCESS', ...payload }, workspaceId);
      }
      await reload();
    } finally {
      setSaving(false);
    }
  };
  return (
    <PanelShell
      title="Model access"
      description="Provider/model allow and block lists. Wildcards are supported (e.g. gpt-4*)."
      canManage={canManage}
      saving={saving}
      onSave={save}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-medium">Allowed models (one per line, empty = all)</p>
          <TextArea value={allowedModels} onChange={setAllowedModels} disabled={!canManage} />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium">Blocked models (one per line)</p>
          <TextArea value={blockedModels} onChange={setBlockedModels} disabled={!canManage} />
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium">Allowed roles (empty = every role)</p>
        <div className="flex flex-wrap gap-3">
          {ROLES.map((role) => (
            <CheckRow
              key={role}
              label={role}
              disabled={!canManage}
              checked={allowedRoles.includes(role)}
              onChange={(checked) =>
                setAllowedRoles(checked ? [...allowedRoles, role] : allowedRoles.filter((item) => item !== role))
              }
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">Status</span>
        {(['ACTIVE', 'DISABLED'] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={status === value ? 'default' : 'outline'}
            disabled={!canManage}
            onClick={() => setStatus(value)}
          >
            {value}
          </Button>
        ))}
      </div>
    </PanelShell>
  );
}
export function FeaturePoliciesPanel() {
  const { currentRole } = useWorkspaceStore();
  const canManage = hasPermission(currentRole, 'AI_GOVERNANCE_MANAGE');
  const { workspaceId, policies, reload } = useGovernancePolicies('FEATURE');
  const [rows, setRows] = React.useState<Record<GovernanceFeature, { enabled: boolean; allowedRoles: WorkspaceRole[] }>>({
    AI_WORKFLOW_CREATE: { enabled: true, allowedRoles: [] },
    AI_ANALYSIS: { enabled: true, allowedRoles: [] },
    AI_OPTIMIZATION: { enabled: true, allowedRoles: [] },
    AI_AGENT: { enabled: true, allowedRoles: [] },
  });
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setRows((current) => {
      const next = { ...current };
      for (const policy of policies as AIFeaturePolicyDTO[]) {
        next[policy.feature] = { enabled: policy.enabled, allowedRoles: policy.allowedRoles ?? [] };
      }
      return next;
    });
  }, [policies]);

  const updateRow = (feature: GovernanceFeature, patch: Partial<{ enabled: boolean; allowedRoles: WorkspaceRole[] }>) => {
    setRows((current) => ({ ...current, [feature]: { ...current[feature], ...patch } }));
  };

  const save = async () => {
    setSaving(true);
    try {
      for (const feature of GOVERNANCE_FEATURES) {
        await aiGovernancePolicyApi.createPolicy(
          { type: 'FEATURE', feature, enabled: rows[feature].enabled, allowedRoles: rows[feature].allowedRoles },
          workspaceId
        );
      }
      await reload();
    } finally {
      setSaving(false);
    }
  };
  return (
    <PanelShell
      title="Feature policies"
      description="Per-feature entitlements and the roles allowed to use them."
      canManage={canManage}
      saving={saving}
      onSave={save}
    >
      <div className="space-y-2">
        {GOVERNANCE_FEATURES.map((feature) => (
          <div key={feature} className="flex flex-wrap items-center justify-between gap-3 border-b pb-2 last:border-0">
            <CheckRow
              label={feature}
              disabled={!canManage}
              checked={rows[feature].enabled}
              onChange={(checked) => updateRow(feature, { enabled: checked })}
            />
            <div className="flex flex-wrap gap-3">
              {ROLES.map((role) => (
                <CheckRow
                  key={`${feature}-${role}`}
                  label={role}
                  disabled={!canManage}
                  checked={rows[feature].allowedRoles.includes(role)}
                  onChange={(checked) =>
                    updateRow(feature, {
                      allowedRoles: checked
                        ? [...rows[feature].allowedRoles, role]
                        : rows[feature].allowedRoles.filter((item) => item !== role),
                    })
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}
export function PromptPolicyPanel() {
  const { currentRole } = useWorkspaceStore();
  const canManage = hasPermission(currentRole, 'AI_GOVERNANCE_MANAGE');
  const { workspaceId, policies, reload } = useGovernancePolicies('PROMPT');
  const existing = (policies[0] as AIPromptPolicyDTO | undefined) ?? null;
  const [blocked, setBlocked] = React.useState('');
  const [approval, setApproval] = React.useState('');
  const [severity, setSeverity] = React.useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!existing) return;
    setBlocked(existing.blockedPatterns.join('\n'));
    setApproval(existing.requiredApprovalPatterns.join('\n'));
    setSeverity(existing.severity ?? 'MEDIUM');
  }, [existing]);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        blockedPatterns: splitLines(blocked),
        requiredApprovalPatterns: splitLines(approval),
        severity,
      };
      if (existing?._id) {
        await aiGovernancePolicyApi.updatePolicy(existing._id, payload, workspaceId);
      } else {
        await aiGovernancePolicyApi.createPolicy({ type: 'PROMPT', ...payload }, workspaceId);
      }
      await reload();
    } finally {
      setSaving(false);
    }
  };
  return (
    <PanelShell
      title="Prompt policies"
      description="Regex patterns that block prompts or require human approval before execution."
      canManage={canManage}
      saving={saving}
      onSave={save}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-medium">Blocked patterns (one regex per line)</p>
          <TextArea value={blocked} onChange={setBlocked} disabled={!canManage} placeholder="drop\\s+database" />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium">Approval-required patterns (one regex per line)</p>
          <TextArea value={approval} onChange={setApproval} disabled={!canManage} placeholder="confidential" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">Severity</span>
        {(['LOW', 'MEDIUM', 'HIGH'] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={severity === value ? 'default' : 'outline'}
            disabled={!canManage}
            onClick={() => setSeverity(value)}
          >
            {value}
          </Button>
        ))}
      </div>
    </PanelShell>
  );
}
export function PrivacyRulesPanel() {
  const { currentRole } = useWorkspaceStore();
  const canManage = hasPermission(currentRole, 'AI_GOVERNANCE_MANAGE');
  const { workspaceId, policies, reload } = useGovernancePolicies('PRIVACY');
  const existing = (policies[0] as AIPrivacyPolicyDTO | undefined) ?? null;
  const [redactClasses, setRedactClasses] = React.useState<PIIDataClass[]>([]);
  const [allowClasses, setAllowClasses] = React.useState<PIIDataClass[]>([]);
  const [blockSensitive, setBlockSensitive] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!existing) return;
    setRedactClasses(existing.redactionRules.map((rule) => rule.dataClass));
    setAllowClasses(existing.allowedDataClasses ?? []);
    setBlockSensitive(Boolean(existing.blockSensitiveData));
  }, [existing]);

  const toggle = (list: PIIDataClass[], value: PIIDataClass, checked: boolean): PIIDataClass[] =>
    checked ? [...list, value] : list.filter((item) => item !== value);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        allowedDataClasses: allowClasses,
        redactionRules: redactClasses.map((dataClass) => ({ dataClass, action: 'REDACT' as const })),
        blockSensitiveData: blockSensitive,
      };
      if (existing?._id) {
        await aiGovernancePolicyApi.updatePolicy(existing._id, payload, workspaceId);
      } else {
        await aiGovernancePolicyApi.createPolicy({ type: 'PRIVACY', ...payload }, workspaceId);
      }
      await reload();
    } finally {
      setSaving(false);
    }
  };
  return (
    <PanelShell
      title="Privacy rules"
      description="Sensitive data classes redacted before prompts reach the provider."
      canManage={canManage}
      saving={saving}
      onSave={save}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-medium">Redact classes</p>
          <div className="flex flex-wrap gap-3">
            {PII_DATA_CLASSES.map((dataClass) => (
              <CheckRow
                key={`redact-${dataClass}`}
                label={dataClass}
                disabled={!canManage}
                checked={redactClasses.includes(dataClass)}
                onChange={(checked) => setRedactClasses(toggle(redactClasses, dataClass, checked))}
              />
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium">Allowed through untouched</p>
          <div className="flex flex-wrap gap-3">
            {PII_DATA_CLASSES.map((dataClass) => (
              <CheckRow
                key={`allow-${dataClass}`}
                label={dataClass}
                disabled={!canManage}
                checked={allowClasses.includes(dataClass)}
                onChange={(checked) => setAllowClasses(toggle(allowClasses, dataClass, checked))}
              />
            ))}
          </div>
        </div>
      </div>
      <CheckRow
        label="Block requests that contain sensitive data instead of redacting"
        disabled={!canManage}
        checked={blockSensitive}
        onChange={setBlockSensitive}
      />
    </PanelShell>
  );
}
export function UsageLimitsPanel() {
  const { currentRole } = useWorkspaceStore();
  const canManage = hasPermission(currentRole, 'AI_GOVERNANCE_MANAGE');
  const { workspaceId, policies, reload } = useGovernancePolicies('USAGE_LIMIT');
  const existing = (policies[0] as AIUsageLimitPolicyDTO | undefined) ?? null;

  const [dailyTokenLimit, setDailyTokenLimit] = React.useState(0);
  const [monthlyTokenLimit, setMonthlyTokenLimit] = React.useState(0);
  const [dailyCostLimit, setDailyCostLimit] = React.useState(0);
  const [monthlyCostLimit, setMonthlyCostLimit] = React.useState(0);
  const [actionOnExceeded, setActionOnExceeded] = React.useState<'THROTTLE' | 'BLOCK'>('THROTTLE');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!existing) return;
    setDailyTokenLimit(existing.dailyTokenLimit ?? 0);
    setMonthlyTokenLimit(existing.monthlyTokenLimit ?? 0);
    setDailyCostLimit(existing.dailyCostLimit ?? 0);
    setMonthlyCostLimit(existing.monthlyCostLimit ?? 0);
    setActionOnExceeded(existing.actionOnExceeded ?? 'THROTTLE');
  }, [existing]);
  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        dailyTokenLimit,
        monthlyTokenLimit,
        dailyCostLimit,
        monthlyCostLimit,
        actionOnExceeded,
      };
      if (existing?._id) {
        await aiGovernancePolicyApi.updatePolicy(existing._id, payload, workspaceId);
      } else {
        await aiGovernancePolicyApi.createPolicy({ type: 'USAGE_LIMIT', ...payload }, workspaceId);
      }
      await reload();
    } finally {
      setSaving(false);
    }
  };
  return (
    <PanelShell
      title="Usage limits"
      description="Token and cost caps over rolling 24h and calendar-month windows. Zero disables a limit."
      canManage={canManage}
      saving={saving}
      onSave={save}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-medium">Daily token limit</p>
          <NumberInput value={dailyTokenLimit} onChange={setDailyTokenLimit} disabled={!canManage} />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium">Monthly token limit</p>
          <NumberInput value={monthlyTokenLimit} onChange={setMonthlyTokenLimit} disabled={!canManage} />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium">Daily cost limit (USD)</p>
          <NumberInput value={dailyCostLimit} onChange={setDailyCostLimit} disabled={!canManage} step="0.1" />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium">Monthly cost limit (USD)</p>
          <NumberInput value={monthlyCostLimit} onChange={setMonthlyCostLimit} disabled={!canManage} step="0.1" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">When a limit is exceeded</span>
        {(['THROTTLE', 'BLOCK'] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={actionOnExceeded === value ? 'default' : 'outline'}
            disabled={!canManage}
            onClick={() => setActionOnExceeded(value)}
          >
            {value}
          </Button>
        ))}
      </div>
    </PanelShell>
  );
}
export function ApprovalPolicyPanel() {
  const { currentRole } = useWorkspaceStore();
  const canManage = hasPermission(currentRole, 'AI_GOVERNANCE_MANAGE');
  const { workspaceId, policies, reload } = useGovernancePolicies('APPROVAL');
  const existing = (policies[0] as AIApprovalPolicyDTO | undefined) ?? null;

  const [conditions, setConditions] = React.useState<AIApprovalPolicyDTO['conditions']>({
    premiumModel: false,
    highCost: false,
    riskLevel: false,
    sensitivePrompt: false,
  });
  const [highCostThresholdUSD, setHighCostThresholdUSD] = React.useState(1);
  const [requiredApproverRole, setRequiredApproverRole] = React.useState<WorkspaceRole>('ADMIN');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!existing) return;
    setConditions({
      premiumModel: Boolean(existing.conditions?.premiumModel),
      highCost: Boolean(existing.conditions?.highCost),
      riskLevel: Boolean(existing.conditions?.riskLevel),
      sensitivePrompt: Boolean(existing.conditions?.sensitivePrompt),
    });
    setHighCostThresholdUSD(existing.highCostThresholdUSD ?? 1);
    setRequiredApproverRole(existing.requiredApproverRole ?? 'ADMIN');
  }, [existing]);
  const save = async () => {
    setSaving(true);
    try {
      const payload = { conditions, highCostThresholdUSD, requiredApproverRole };
      if (existing?._id) {
        await aiGovernancePolicyApi.updatePolicy(existing._id, payload, workspaceId);
      } else {
        await aiGovernancePolicyApi.createPolicy({ type: 'APPROVAL', ...payload }, workspaceId);
      }
      await reload();
    } finally {
      setSaving(false);
    }
  };

  return (
    <PanelShell
      title="Human approval policy"
      description="Operations matching any enabled condition join the unified AI approvals queue."
      canManage={canManage}
      saving={saving}
      onSave={save}
    >
      <div className="space-y-2">
        <CheckRow
          label="Premium model usage"
          disabled={!canManage}
          checked={conditions.premiumModel}
          onChange={(checked) => setConditions((current) => ({ ...current, premiumModel: checked }))}
        />
        <CheckRow
          label="Estimated cost above threshold"
          disabled={!canManage}
          checked={conditions.highCost}
          onChange={(checked) => setConditions((current) => ({ ...current, highCost: checked }))}
        />
        <CheckRow
          label="High risk requests"
          disabled={!canManage}
          checked={conditions.riskLevel}
          onChange={(checked) => setConditions((current) => ({ ...current, riskLevel: checked }))}
        />
        <CheckRow
          label="Prompts flagged by prompt or privacy policy"
          disabled={!canManage}
          checked={conditions.sensitivePrompt}
          onChange={(checked) => setConditions((current) => ({ ...current, sensitivePrompt: checked }))}
        />
      </div>      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-medium">Cost approval threshold (USD)</p>
          <NumberInput
            value={highCostThresholdUSD}
            onChange={setHighCostThresholdUSD}
            disabled={!canManage}
            step="0.1"
          />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium">Required approver role</p>
          <div className="flex flex-wrap gap-2">
            {ROLES.map((role) => (
              <Button
                key={role}
                size="sm"
                variant={requiredApproverRole === role ? 'default' : 'outline'}
                disabled={!canManage}
                onClick={() => setRequiredApproverRole(role)}
              >
                {role}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </PanelShell>
  );
}