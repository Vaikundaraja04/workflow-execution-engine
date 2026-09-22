import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ComplianceReport } from '@/features/security/components/ComplianceReport';

vi.mock('@/services/securityApi', () => ({
  securityApi: {
    getComplianceReport: vi.fn(),
  },
}));

import { securityApi } from '@/services/securityApi';

const soc2Report = {
  accessManagement: {
    totalUsers: 5,
    mfaEnabledUsers: 3,
    passwordPolicyCompliant: true,
  },
  encryption: {
    dataAtRestEncrypted: true,
    dataInTransitEncrypted: false,
    lastKeyRotation: '2026-08-08T16:24:56.082Z',
  },
  processingActivities: [
    { activityName: 'Workflow Execution', lawfulBasis: 'Legitimate Interest' },
  ],
};

describe('ComplianceReport', () => {
  beforeEach(() => {
    vi.mocked(securityApi.getComplianceReport).mockReset();
  });

  it('renders the real API shape without crashing', async () => {
    vi.mocked(securityApi.getComplianceReport).mockResolvedValue(soc2Report as never);

    render(<ComplianceReport />);

    await waitFor(() => {
      expect(screen.getByText(/access management/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/total users/i)).toBeInTheDocument();
    expect(screen.getByText('Workflow Execution')).toBeInTheDocument();
    expect(screen.getAllByText(/compliant/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/attention/i)).toBeInTheDocument();
  });

  it('shows an error banner when the report request fails', async () => {
    vi.mocked(securityApi.getComplianceReport).mockRejectedValue(new Error('boom'));

    render(<ComplianceReport />);

    await waitFor(() => {
      expect(screen.getByText(/boom/i)).toBeInTheDocument();
    });
  });
});
