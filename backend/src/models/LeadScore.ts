import mongoose, { Schema, Document } from 'mongoose';

export interface ILeadScore extends Document {
  score_id: string;
  lead_id: string;
  fit_score: number;
  budget_score: number;
  urgency_score: number;
  project_value_score: number;
  recurring_score: number;
  communication_score: number;
  risk_score: number;
  total_score: number;
  priority: string;
  rationale: string;
}

const leadScoreSchema = new Schema({
  score_id: { type: String, required: true, unique: true },
  lead_id: { type: String, required: true, unique: true },
  fit_score: { type: Number, default: 0 },
  budget_score: { type: Number, default: 0 },
  urgency_score: { type: Number, default: 0 },
  project_value_score: { type: Number, default: 0 },
  recurring_score: { type: Number, default: 0 },
  communication_score: { type: Number, default: 0 },
  risk_score: { type: Number, default: 0 },
  total_score: { type: Number, default: 0 },
  priority: { type: String },
  rationale: { type: String }
}, { timestamps: true });

export const LeadScore = mongoose.model<ILeadScore>('LeadScore', leadScoreSchema);
