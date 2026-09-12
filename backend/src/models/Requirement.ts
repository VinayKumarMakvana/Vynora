import mongoose, { Schema, Document } from 'mongoose';

export interface IRequirement extends Document {
  requirement_id: string;
  opportunity_id: string;
  lead_id: string;
  meeting_id?: string;
  business_problem?: string;
  desired_solution?: string;
  scope?: string;
  features?: string;
  integrations?: string;
  platform?: string;
  technology?: string;
  users?: string;
  complexity?: string;
  timeline?: string;
  budget?: string;
  assumptions?: string;
  missing_items?: string;
  status: string;
}

const requirementSchema = new Schema({
  requirement_id: { type: String, required: true, unique: true },
  opportunity_id: { type: String, required: true },
  lead_id: { type: String, required: true },
  meeting_id: { type: String },
  business_problem: { type: String },
  desired_solution: { type: String },
  scope: { type: String },
  features: { type: String },
  integrations: { type: String },
  platform: { type: String },
  technology: { type: String },
  users: { type: String },
  complexity: { type: String },
  timeline: { type: String },
  budget: { type: String },
  assumptions: { type: String },
  missing_items: { type: String },
  status: { type: String, required: true, default: 'Draft' }
}, { timestamps: true });

export const Requirement = mongoose.model<IRequirement>('Requirement', requirementSchema);
