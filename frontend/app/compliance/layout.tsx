import * as React from 'react';
import { AppShell } from '@/components/layout/AppShell';

export default function SectionLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
