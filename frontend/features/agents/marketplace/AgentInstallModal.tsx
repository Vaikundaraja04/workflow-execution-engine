'use client';

import * as React from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import type { AgentMarketplaceListingDTO, InstallAgentConfigurationDTO } from '@/types/agentMarketplace';

export interface AgentInstallModalProps {
  listing: AgentMarketplaceListingDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (configuration: InstallAgentConfigurationDTO) => Promise<void> | void;
}

export function AgentInstallModal({ listing, open, onOpenChange, onConfirm }: AgentInstallModalProps) {
  const [temperature, setTemperature] = React.useState('0.7');
  const [maxTurns, setMaxTurns] = React.useState('5');
  const [installing, setInstalling] = React.useState(false);

  const confirm = async () => {
    setInstalling(true);
    try {
      const configuration: InstallAgentConfigurationDTO = {};
      const parsedTemperature = Number(temperature);
      if (Number.isFinite(parsedTemperature)) configuration.temperature = parsedTemperature;
      const parsedMaxTurns = Number(maxTurns);
      if (Number.isFinite(parsedMaxTurns) && parsedMaxTurns > 0) configuration.maxTurns = parsedMaxTurns;
      await onConfirm(configuration);
    } finally {
      setInstalling(false);
    }
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={listing ? `Install ${listing.name}` : 'Install agent'}>
      <div className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="font-medium">Temperature</span>
            <input
              value={temperature}
              onChange={(event) => setTemperature(event.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1 dark:border-gray-700 dark:bg-gray-900"
            />
          </label>
          <label className="space-y-1">
            <span className="font-medium">Max turns</span>
            <input
              value={maxTurns}
              onChange={(event) => setMaxTurns(event.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1 dark:border-gray-700 dark:bg-gray-900"
            />
          </label>
        </div>
        <p className="text-muted-foreground">
          The published agent definition is cloned into this workspace and can be configured further from the
          agents console.
        </p>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" isLoading={installing} onClick={() => void confirm()}>
            Install
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default AgentInstallModal;