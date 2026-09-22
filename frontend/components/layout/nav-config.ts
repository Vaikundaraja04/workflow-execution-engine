import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  Boxes,
  Briefcase,
  CreditCard,
  Cpu,
  FileText,
  Gauge,
  Globe,
  LayoutDashboard,
  Package,
  PlayCircle,
  Rocket,
  Settings,
  Shield,
  Sparkles,
  Store,
  TrendingUp,
  Users,
  Workflow,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Automation',
    items: [
      { href: '/workflows', label: 'Workflows', icon: Workflow },
      { href: '/executions', label: 'Executions', icon: PlayCircle },
      { href: '/dead-letters', label: 'Dead Letters', icon: AlertTriangle },
    ],
  },
  {
    label: 'Agents & AI',
    items: [
      { href: '/agents', label: 'Agents', icon: Bot },
      { href: '/agents/marketplace', label: 'Agent Marketplace', icon: Store },
      { href: '/ai/workflow-generator', label: 'AI Workflow Generator', icon: Sparkles },
      { href: '/ai/template-generator', label: 'AI Templates', icon: Boxes },
      { href: '/ai/optimization', label: 'AI Optimization', icon: Gauge },
      { href: '/ai/usage', label: 'AI Usage', icon: BarChart3 },
    ],
  },
  {
    label: 'Security & Compliance',
    items: [
      { href: '/security', label: 'Security Center', icon: Shield },
      { href: '/security/sessions', label: 'Sessions', icon: Users },
      { href: '/security/secrets', label: 'Secrets Vault', icon: Package },
      { href: '/security/compliance', label: 'Compliance', icon: FileText },
      { href: '/security/audit', label: 'Audit Explorer', icon: Activity },
      { href: '/security/policy', label: 'Security Policy', icon: Settings },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/operations', label: 'Operations Console', icon: Gauge },
      { href: '/operations/analytics', label: 'Analytics', icon: BarChart3 },
      { href: '/operations/optimization', label: 'Optimization', icon: Rocket },
      { href: '/operations/predictions', label: 'Predictions', icon: TrendingUp },
      { href: '/operations/autonomous', label: 'Autonomous Ops', icon: Cpu },
      { href: '/operations/reports', label: 'Reports', icon: FileText },
      { href: '/operations/security', label: 'Ops Security', icon: Shield },
    ],
  },
  {
    label: 'Platform',
    items: [
      { href: '/platform', label: 'Global Platform', icon: Globe },
      { href: '/platform/infrastructure', label: 'Infrastructure', icon: Cpu },
      { href: '/platform/regions', label: 'Regions', icon: Globe },
      { href: '/platform/tenants', label: 'Tenants', icon: Briefcase },
      { href: '/platform/ai-governance', label: 'AI Governance', icon: Shield },
      { href: '/platform/readiness', label: 'Readiness', icon: Activity },
    ],
  },
  {
    label: 'Business',
    items: [
      { href: '/analytics/business', label: 'Business Analytics', icon: BarChart3 },
      { href: '/analytics/marketplace', label: 'Marketplace Analytics', icon: Store },
      { href: '/growth', label: 'Growth', icon: TrendingUp },
      { href: '/publisher', label: 'Publisher Portal', icon: Rocket },
      { href: '/compliance', label: 'Enterprise Compliance', icon: FileText },
      { href: '/enterprise/console', label: 'Enterprise Console', icon: Briefcase },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/customer', label: 'Customer Console', icon: CreditCard },
      { href: '/admin/customers', label: 'Customer Management', icon: Users },
    ],
  },
];

export default NAV_GROUPS;
