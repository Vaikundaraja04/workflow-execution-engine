'use client';

import React, { useState } from 'react';
import type { ProductionAlertDTO } from '@/types/continuousMonitoring';

export interface AlertCenterProps {
  alerts: ProductionAlertDTO[];
  onAcknowledge?: (alertId: string) => Promise<void> | void;
}

const SEVERITY_CLASSES: Record<ProductionAlertDTO['severity'], string> = {
  CRITICAL: 'bg-red-100 text-red-800',
  WARNING: 'bg-yellow-100 text-yellow-800',
};

export function AlertCenter({ alerts, onAcknowledge }: AlertCenterProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const openAlerts = alerts.filter((alert) => alert.status === 'OPEN');
  const acknowledged = alerts.filter((alert) => alert.status === 'ACKNOWLEDGED');

  const acknowledge = async (alertId: string) => {
    if (!onAcknowledge) return;
    setBusyId(alertId);
    try {
      await onAcknowledge(alertId);
    } finally {
      setBusyId(null);
    }
  };
  return (
    <section data-testid="alert-center" className="rounded-lg border bg-white p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Production alerts</h2>
        <span data-testid="alert-center-summary" className="text-sm text-gray-500">
          {openAlerts.length} open / {alerts.length} total
        </span>
      </header>
      {alerts.length === 0 ? (
        <p className="text-sm text-gray-500">No production alerts.</p>
      ) : (
        <ul data-testid="alert-list" className="space-y-2">
          {alerts.map((alert) => (
            <li key={alert.id} data-testid={`alert-${alert.id}`} className="rounded border p-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span
                    className={`mr-2 rounded px-2 py-0.5 text-xs font-semibold ${SEVERITY_CLASSES[alert.severity]}`}
                  >
                    {alert.severity}
                  </span>
                  <span className="font-medium">{alert.title}</span>
                </div>
                {alert.status === 'OPEN' && onAcknowledge ? (
                  <button
                    type="button"
                    data-testid={`acknowledge-${alert.id}`}
                    onClick={() => void acknowledge(alert.id)}
                    disabled={busyId === alert.id}
                    className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                  >
                    Acknowledge
                  </button>
                ) : (
                  <span className="text-xs text-gray-500">{alert.status}</span>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-600">{alert.details}</p>
            </li>
          ))}
        </ul>
      )}
      {acknowledged.length > 0 ? (
        <p data-testid="alert-center-acknowledged" className="mt-2 text-xs text-gray-500">
          {acknowledged.length} acknowledged
        </p>
      ) : null}
    </section>
  );
}

export default AlertCenter;