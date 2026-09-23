'use client';

import * as React from 'react';
import { ReadinessConsole } from '@/features/release-readiness/components/ReadinessConsole';

export default function ReadinessPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="container mx-auto">
        <ReadinessConsole />
      </div>
    </div>
  );
}
