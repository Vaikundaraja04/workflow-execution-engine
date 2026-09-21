'use client';

import * as React from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { SessionManager } from '@/features/security/components/SessionManager';

export function SecuritySettings() {
  return (
    <section aria-label="Security settings" className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-lg">Security preferences</CardTitle>
              <CardDescription>
                Sessions and devices are managed by the workspace security service. Revoking a session
                takes effect on the next request from that device.
              </CardDescription>
            </div>
            <Badge variant="info">Workspace security</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 text-sm">
          <Link href="/security" className="font-medium text-emerald-700 hover:text-emerald-800">
            Security console
          </Link>
          <Link href="/security/sessions" className="font-medium text-emerald-700 hover:text-emerald-800">
            Session policy
          </Link>
          <Link href="/security/audit" className="font-medium text-emerald-700 hover:text-emerald-800">
            Audit trail
          </Link>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <ShieldCheck className="h-4 w-4" />
            Password, MFA and IP allowlist policy stay in the security console.
          </span>
        </CardContent>
      </Card>

      <SessionManager />
    </section>
  );
}

export default SecuritySettings;
