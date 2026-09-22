import mongoose, { Schema } from 'mongoose';
import { SOLUTION_IDS } from '../services/solutionTemplateService.js';
import type { SolutionId } from '../services/solutionTemplateService.js';

/**
 * Phase 16.3 - Enterprise demo scenarios.
 *
 * A scenario is the sales-ready package for one industry: the solution whose
 * workflows and agents get installed into the sandbox, the explanation the
 * seller walks through and the sample runs that show what the automation does.
 * Content lives in solutionTemplateService; this model stores the scenario
 * framing (naming, ordering, talk track) so demos can be curated without code.
 */

export const DEMO_SCENARIO_IDS = [
  'it-helpdesk',
  'hr-automation',
  'finance-approval',
  'customer-support',
  'sales-automation',
] as const;
export type DemoScenarioId = (typeof DEMO_SCENARIO_IDS)[number];

export interface DemoScenarioHighlight {
  title: string;
  detail: string;
}

export interface IDemoScenario {
  id: DemoScenarioId;
  name: string;
  industry: string;
  solutionId: SolutionId;
  headline: string;
  explanation: string;
  talkTrack: string[];
  highlights: DemoScenarioHighlight[];
  persona: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const DemoScenarioHighlightSchema = new Schema<DemoScenarioHighlight>({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  detail: { type: String, required: true, trim: true, maxlength: 400 },
}, { _id: false });

const DemoScenarioSchema = new Schema<IDemoScenario>({
  id: { type: String, enum: [...DEMO_SCENARIO_IDS], required: true, unique: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  industry: { type: String, required: true, trim: true, maxlength: 80 },
  solutionId: { type: String, enum: [...SOLUTION_IDS], required: true },
  headline: { type: String, required: true, trim: true, maxlength: 200 },
  explanation: { type: String, required: true, trim: true, maxlength: 2000 },
  talkTrack: { type: [String], default: [] },
  highlights: { type: [DemoScenarioHighlightSchema], default: [] },
  persona: { type: String, required: true, trim: true, maxlength: 160 },
  sortOrder: { type: Number, required: true, default: 0 },
  isActive: { type: Boolean, required: true, default: true },
}, { timestamps: true });

DemoScenarioSchema.index({ sortOrder: 1 });

export const DemoScenarioModel = mongoose.model<IDemoScenario>('DemoScenario', DemoScenarioSchema);

export function isDemoScenarioId(value: unknown): value is DemoScenarioId {
  return typeof value === 'string' && (DEMO_SCENARIO_IDS as readonly string[]).includes(value);
}
