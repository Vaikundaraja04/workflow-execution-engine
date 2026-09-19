'use client';

import React from 'react';
import PrivacyCenter from '@/features/security/components/PrivacyCenter';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PrivacyCenter />
      </div>
    </div>
  );
}