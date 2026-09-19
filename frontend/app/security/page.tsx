'use client';

import React from 'react';
import SecurityDashboard from '@/features/security/components/SecurityDashboard';

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <SecurityDashboard />
      </div>
    </div>
  );
}