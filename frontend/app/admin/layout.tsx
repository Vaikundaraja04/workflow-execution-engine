import * as React from 'react';
import { AppShell } from '@/components/layout/AppShell';

export default function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
