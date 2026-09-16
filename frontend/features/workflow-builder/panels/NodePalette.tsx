import * as React from 'react';
import {
  Play,
  Webhook,
  Clock,
  Globe,
  Mail,
  Database,
  Bell,
  FileText,
  GitBranch,
  Search,
  Layers,
  Sparkles,
} from 'lucide-react';
import { useWorkflowBuilderStore } from '../stores/workflowBuilderStore';
import type { NodePaletteItem, BuilderNodeType } from '../types/workflowBuilder';

const PALETTE_ITEMS: NodePaletteItem[] = [
  // Triggers
  {
    type: 'webhook_trigger',
    category: 'trigger',
    label: 'Webhook Trigger',
    description: 'Triggers workflow via HTTP POST endpoint',
    icon: 'webhook',
    defaultConfig: { path: '/webhook', method: 'POST', authRequired: false },
    badge: 'Popular',
  },
  {
    type: 'manual_trigger',
    category: 'trigger',
    label: 'Manual Trigger',
    description: 'Allows manual test or admin execution',
    icon: 'play',
    defaultConfig: { description: 'Manual trigger execution' },
  },
  {
    type: 'schedule_trigger',
    category: 'trigger',
    label: 'Schedule Trigger',
    description: 'Cron or recurring time-based trigger',
    icon: 'clock',
    defaultConfig: { cronExpression: '0 * * * *', timezone: 'UTC' },
  },

  // Actions
  {
    type: 'http_request',
    category: 'action',
    label: 'HTTP Request',
    description: 'Send REST API requests with auth & headers',
    icon: 'globe',
    defaultConfig: { url: 'https://api.example.com/endpoint', method: 'GET', timeoutMs: 5000 },
    badge: 'Core',
  },
  {
    type: 'email',
    category: 'action',
    label: 'Send Email',
    description: 'Send transactional emails to users or alerts',
    icon: 'mail',
    defaultConfig: { recipient: 'team@example.com', subject: 'Workflow Alert', message: 'Hello' },
  },
  {
    type: 'database_query',
    category: 'action',
    label: 'Database Query',
    description: 'Execute SQL or MongoDB queries',
    icon: 'database',
    defaultConfig: { query: 'SELECT * FROM records LIMIT 10;', database: 'primary' },
  },
  {
    type: 'notification',
    category: 'action',
    label: 'Notification',
    description: 'Deliver Slack, in-app, or webhook alerts',
    icon: 'bell',
    defaultConfig: { channel: 'in_app', message: 'Task completed successfully', level: 'info' },
  },
  {
    type: 'log',
    category: 'action',
    label: 'Log Message',
    description: 'Log execution data for audit & debug',
    icon: 'log',
    defaultConfig: { message: 'Workflow execution step reached' },
  },

  // Logic
  {
    type: 'condition',
    category: 'logic',
    label: 'Condition / Branch',
    description: 'Evaluate rule and branch True / False',
    icon: 'branch',
    defaultConfig: { field: 'status', operator: 'equals', value: 'active' },
    badge: 'Logic',
  },
  {
    type: 'delay',
    category: 'logic',
    label: 'Delay / Timer',
    description: 'Pause execution for N seconds',
    icon: 'clock',
    defaultConfig: { durationSeconds: 10, mode: 'fixed' },
  },

  // Marketplace
  {
    type: 'installed_template',
    category: 'marketplace',
    label: 'Order Processing',
    description: 'Prebuilt template for e-commerce orders',
    icon: 'sparkles',
    defaultConfig: { templateName: 'Order Processing' },
    badge: 'Template',
  },
];

function getIcon(iconName: string) {
  switch (iconName) {
    case 'webhook':
      return <Webhook className="h-4 w-4 text-purple-600" />;
    case 'play':
      return <Play className="h-4 w-4 text-blue-600" />;
    case 'clock':
      return <Clock className="h-4 w-4 text-amber-600" />;
    case 'globe':
      return <Globe className="h-4 w-4 text-emerald-600" />;
    case 'mail':
      return <Mail className="h-4 w-4 text-sky-600" />;
    case 'database':
      return <Database className="h-4 w-4 text-indigo-600" />;
    case 'bell':
      return <Bell className="h-4 w-4 text-amber-600" />;
    case 'branch':
      return <GitBranch className="h-4 w-4 text-amber-600" />;
    case 'sparkles':
      return <Sparkles className="h-4 w-4 text-purple-600" />;
    default:
      return <FileText className="h-4 w-4 text-slate-600" />;
  }
}

export const NodePalette: React.FC = () => {
  const [searchTerm, setSearchTerm] = React.useState('');
  const [activeCategory, setActiveCategory] = React.useState<string>('all');
  const { addNode, isReadOnly } = useWorkflowBuilderStore();

  const filteredItems = PALETTE_ITEMS.filter((item) => {
    const matchesSearch =
      item.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCat = activeCategory === 'all' || item.category === activeCategory;
    return matchesSearch && matchesCat;
  });

  const onDragStart = (event: React.DragEvent, nodeType: BuilderNodeType) => {
    event.dataTransfer.setData('application/reactflow/type', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleClickItem = (item: NodePaletteItem) => {
    if (isReadOnly) return;
    const randomOffset = Math.floor(Math.random() * 80);
    addNode(item.type, { x: 250 + randomOffset, y: 150 + randomOffset }, item.defaultConfig);
  };

  const categories = [
    { id: 'all', label: 'All' },
    { id: 'trigger', label: 'Triggers' },
    { id: 'action', label: 'Actions' },
    { id: 'logic', label: 'Logic' },
    { id: 'marketplace', label: 'Templates' },
  ];

  return (
    <div className="flex h-full flex-col bg-white border-r border-gray-200 select-none">
      {/* Search Header */}
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center space-x-2 text-xs font-semibold text-gray-700">
          <Layers className="h-4 w-4 text-primary" />
          <span>Node Palette</span>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search nodes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-gray-200 bg-gray-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Category Tabs */}
        <div className="flex space-x-1 overflow-x-auto pb-1 text-[11px]">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-2 py-1 rounded-md transition-colors shrink-0 ${
                activeCategory === cat.id
                  ? 'bg-primary text-white font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Palette Item List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filteredItems.map((item) => (
          <div
            key={item.type}
            draggable={!isReadOnly}
            onDragStart={(e) => onDragStart(e, item.type)}
            onClick={() => handleClickItem(item)}
            className={`p-2.5 rounded-lg border border-gray-200 bg-white hover:border-primary hover:shadow-xs cursor-grab active:cursor-grabbing transition-all ${
              isReadOnly ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            <div className="flex items-start space-x-2.5">
              <div className="p-1.5 rounded-md bg-gray-50 border border-gray-100 shrink-0">
                {getIcon(item.icon)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-gray-800 truncate">{item.label}</h4>
                  {item.badge && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-blue-50 text-blue-700 font-medium border border-blue-200">
                      {item.badge}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-gray-500 line-clamp-2 mt-0.5">{item.description}</p>
              </div>
            </div>
          </div>
        ))}

        {filteredItems.length === 0 && (
          <div className="text-center py-6 text-xs text-gray-400">
            No matching nodes found
          </div>
        )}
      </div>

      <div className="p-2 border-t text-[11px] text-gray-400 text-center bg-gray-50">
        Drag to canvas or click to add
      </div>
    </div>
  );
};

export default NodePalette;
