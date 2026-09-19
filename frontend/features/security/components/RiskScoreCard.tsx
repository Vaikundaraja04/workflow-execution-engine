import React from 'react';
import {
  TrendingUp,
  ShieldAlert,
  Zap,
  Lock,
  Globe,
  Activity,
  Info
} from 'lucide-react';
import type { RiskScoreData } from '@/types/security.types';

interface RiskScoreCardProps {
  riskScore: RiskScoreData | null;
}

export const RiskScoreCard: React.FC<RiskScoreCardProps> = ({ riskScore }) => {
  if (!riskScore) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
        <div className="text-center py-8">
          <div className="w-12 h-12 mx-auto animate-spin rounded-full border-4 border-indigo-600 border-t-transparent"></div>
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading risk score...</p>
        </div>
      </div>
    );
  }

  const getSeverityColor = (level: string) => {
    switch (level.toLowerCase()) {
      case 'critical': return 'bg-rose-500 text-white';
      case 'high': return 'bg-amber-500 text-white';
      case 'medium': return 'bg-yellow-500 text-black';
      case 'low': return 'bg-emerald-500 text-white';
      case 'info': return 'bg-blue-500 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };

  const getSeverityTextColor = (level: string) => {
    switch (level.toLowerCase()) {
      case 'medium': return 'text-black';
      default: return 'text-white';
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
      <div className="flex items-start justify-between border-b border-gray-100 dark:border-gray-700 pb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-indigo-600" />
            Security Risk Score
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Real-time assessment of security posture across key domains.
          </p>
        </div>
        <div className="text-right">
          <div className="text-4xl font-bold">
            {riskScore.overallScore}
          </div>
          <div className={`px-3 py-1 rounded-full text-xs font-medium ${getSeverityColor(riskScore.riskCategory)} ${getSeverityTextColor(riskScore.riskCategory)}`}>
            {riskScore.riskCategory}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="space-y-4">
          {Object.entries(riskScore.breakdown).map(([domain, data]) => (
            <div key={domain} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full" />
                <span className="font-medium">{domain}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" />
                <span className="font-semibold">{data.score}/100</span>
              </div>
            </div>
          ))}
        </div>

        {riskScore.recommendations?.length ? (
          <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
            <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Actionable Recommendations
            </div>
            <ul className="text-xs space-y-1 text-gray-600 dark:text-gray-300 list-disc list-inside">
              {riskScore.recommendations.map((rec, idx) => (
                <li key={idx}>
                  <span className="font-medium">{typeof rec === 'string' ? rec : rec.title}:</span>{' '}
                  {typeof rec === 'string' ? '' : rec.description || rec.remediationAction}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-indigo-600" />
            <span className="font-medium text-gray-900 dark:text-white">How the score is calculated</span>
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          The Security Risk Score (0-100) is a weighted composite of four key security domains:
        </p>
        <ol className="mt-2 pl-5 text-xs space-y-1 text-gray-600 dark:text-gray-300 list-decimal list-inside">
          <li>Authentication (35%): Failed login rates, MFA adoption, password policy compliance</li>
          <li>Access Control (25%): IP allowlist coverage, session management, privilege escalation</li>
          <li>Data Protection (20%): Encryption at rest/in transit, key rotation, backup integrity</li>
          <li>Network Security (20%): API abuse detection, geo-anomaly scanning, threat intelligence</li>
        </ol>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Lower scores indicate higher risk. A score below 40 requires immediate attention.
        </p>
      </div>
    </div>
  );
};

export default RiskScoreCard;