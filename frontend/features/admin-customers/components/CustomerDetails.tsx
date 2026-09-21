'use client';

import * as React from 'react';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import type { CustomerDetailDTO, TenantStatusDTO } from '@/types/saas';

const STATUS_VARIANTS: Record<TenantStatusDTO, 'success' | 'info' | 'warning' | 'secondary'> = {
  TRIALING: 'info',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  CLOSED: 'secondary',
};

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleDateString() : '—';
}

export function CustomerDetails({
  detail,
  busy,
  actionError,
  onSuspend,
  onReactivate,
  onAddNote,
}: {
  detail: CustomerDetailDTO;
  busy: boolean;
  actionError: string | null;
  onSuspend: () => void;
  onReactivate: () => void;
  onAddNote: (note: string) => Promise<boolean>;
}) {
  const { tenant, profile, workspace } = detail;
  const [note, setNote] = useState('');

  const handleAddNote = async () => {
    const trimmed = note.trim();
    if (!trimmed) return;
    const saved = await onAddNote(trimmed);
    if (saved) setNote('');
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-xl">{tenant.companyName}</CardTitle>
              <CardDescription>
                Tenant {tenant.id} · workspace {tenant.workspaceId}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {tenant.demo ? <Badge variant="warning">Demo</Badge> : null}
              <Badge variant={STATUS_VARIANTS[tenant.status]}>{tenant.status}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Plan</dt>
              <dd className="font-medium text-foreground">{tenant.plan}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Region</dt>
              <dd className="font-medium text-foreground">{tenant.region}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="font-medium text-foreground">{formatDate(tenant.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Trial ends</dt>
              <dd className="font-medium text-foreground">{formatDate(tenant.trialEndsAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Use case</dt>
              <dd className="font-medium text-foreground">{tenant.useCase ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Onboarding</dt>
              <dd className="font-medium text-foreground">
                {tenant.onboarding.completed
                  ? `Completed ${formatDate(tenant.onboarding.completedAt)}`
                  : 'In progress'}
              </dd>
            </div>
          </dl>

          {workspace ? (
            <p className="text-sm text-muted-foreground">
              Workspace: <span className="text-foreground">{workspace.name}</span> ({workspace.slug}) ·{' '}
              {workspace.status}
            </p>
          ) : null}

          {profile ? (
            <dl className="grid grid-cols-1 gap-3 border-t border-border pt-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Contact</dt>
                <dd className="font-medium text-foreground">{profile.contactName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="font-medium text-foreground">{profile.contactEmail}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Phone</dt>
                <dd className="font-medium text-foreground">{profile.contactPhone ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Tax ID</dt>
                <dd className="font-medium text-foreground">{profile.taxId ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Timezone</dt>
                <dd className="font-medium text-foreground">{profile.timezone}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Locale</dt>
                <dd className="font-medium text-foreground">{profile.locale}</dd>
              </div>
            </dl>
          ) : (
            <p className="border-t border-border pt-4 text-sm text-muted-foreground">
              No customer profile has been recorded for this tenant.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Support notes</CardTitle>
          <CardDescription>Internal notes are visible to the platform team only.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {profile?.supportNotes?.length ? (
            <ul className="space-y-3">
              {profile.supportNotes.map((entry) => (
                <li key={`${entry.createdAt}-${entry.authorUserId}`} className="rounded-lg bg-muted p-3">
                  <p className="text-sm text-foreground">{entry.note}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {entry.authorUserId} · {new Date(entry.createdAt).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No support notes recorded yet.</p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Input
              label="Add note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Context for the next operator..."
            />
            <Button
              type="button"
              variant="outline"
              disabled={busy || note.trim().length === 0}
              onClick={handleAddNote}
            >
              Add note
            </Button>
          </div>
        </CardContent>
      </Card>

      {actionError ? (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {actionError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          disabled={busy || tenant.status === 'SUSPENDED' || tenant.status === 'CLOSED'}
          onClick={onSuspend}
        >
          Suspend tenant
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || tenant.status === 'ACTIVE'}
          onClick={onReactivate}
        >
          Reactivate tenant
        </Button>
      </div>
    </div>
  );
}

export default CustomerDetails;
