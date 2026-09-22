import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ComplianceCenterPage from '@/app/compliance/page';
import { enterpriseOperationsApi } from '@/services/enterpriseOperationsApi';
import type { ComplianceReportDTO } from '@/services/enterpriseOperationsApi';

vi.mock('@/services/enterpriseOperationsApi', () => ({
  enterpriseOperationsApi: {
    getComplianceCenter: vi.fn(),
  },
}));

const reportFixture: ComplianceReportDTO = {
  workspaceId: null,
  window: {
    days: 30,
    since: '2026-08-23T00:00:00.000Z',
    until: '2026-09-22T00:00:00.000Z',
  },
  score: 62,
  grade: 'C',
  sections: [
    {
      key: 'auditCoverage',
      label: 'Audit coverage',
      weight: 30,
      score: 67,
      status: 'WARN',
      findings: ['No SECRET_ROTATED recorded in this window'],
      evidence: { entries: 120, distinctActions: 9, coveredActions: 8, expectedActions: 12 },
    },
    {
      key: 'securityControls',
      label: 'Security controls',
      weight: 25,
      score: 100,
      status: 'OK',
      findings: ['No open high severity security events'],
      evidence: { events: 4, openHighSeverity: 0, resolved: 3 },
    },
    {
      key: 'dataAccess',
      label: 'Data access',
      weight: 20,
      score: 100,
      status: 'OK',
      findings: [],
      evidence: { actions: 6 },
    },
    {
      key: 'aiGovernance',
      label: 'AI governance',
      weight: 25,
      score: 0,
      status: 'UNKNOWN',
      findings: ['No AI governance policies configured'],
      evidence: { policies: 0, decisions: 0, pendingApprovals: 0 },
    },
  ],
  notes: ['25 points of weight excluded: no evidence for AI governance'],
  generatedAt: '2026-09-22T10:00:00.000Z',
};

describe('Phase 18.5 compliance center view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(enterpriseOperationsApi.getComplianceCenter).mockResolvedValue(reportFixture);
  });

  it('renders the posture, the section table and the excluded weight notes', async () => {
    render(<ComplianceCenterPage />);

    expect(await screen.findByText('Compliance center')).toBeInTheDocument();
    expect(await screen.findByText('Compliance score')).toBeInTheDocument();
    expect(screen.getByText('62 / 100')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.getByText('Platform-wide')).toBeInTheDocument();
    expect(screen.getByText('25 points of weight excluded: no evidence for AI governance')).toBeInTheDocument();

    expect(screen.getAllByText('Audit coverage')).toHaveLength(2);
    expect(screen.getByText('8 of 12')).toBeInTheDocument();
    expect(screen.getByText('No SECRET_ROTATED recorded in this window')).toBeInTheDocument();

    expect(screen.getAllByText('Security controls')).toHaveLength(2);
    expect(screen.getByText('No open high severity security events')).toBeInTheDocument();

    expect(screen.getByText('Data access')).toBeInTheDocument();
    expect(screen.getByText('AI governance')).toBeInTheDocument();
    expect(screen.getAllByText('UNKNOWN').length).toBeGreaterThan(0);
    expect(enterpriseOperationsApi.getComplianceCenter).toHaveBeenCalledWith({ days: 30 });
  });

  it('reloads the posture when the window changes and scopes it to a workspace', async () => {
    render(<ComplianceCenterPage />);
    await screen.findByText('Compliance center');
    await waitFor(() => {
      expect(enterpriseOperationsApi.getComplianceCenter).toHaveBeenCalledWith({ days: 30 });
    });

    await userEvent.selectOptions(screen.getByLabelText('Window'), 'Last 90 days');
    await waitFor(() => {
      expect(enterpriseOperationsApi.getComplianceCenter).toHaveBeenCalledWith({ days: 90 });
    });

    await userEvent.type(screen.getByLabelText('Workspace scope'), 'ws-42');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      expect(enterpriseOperationsApi.getComplianceCenter).toHaveBeenCalledWith({
        days: 90,
        workspaceId: 'ws-42',
      });
    });
  });

  it('surfaces API failures instead of fabricating a posture', async () => {
    vi.mocked(enterpriseOperationsApi.getComplianceCenter).mockRejectedValue({
      code: 'FORBIDDEN',
      message: 'Insufficient permission for this action',
      status: 403,
    });

    render(<ComplianceCenterPage />);

    expect(await screen.findByText('Could not load the compliance posture')).toBeInTheDocument();
    expect(screen.getByText('Insufficient permission for this action')).toBeInTheDocument();
  });
});
