import mongoose, { Schema, Document } from 'mongoose';

export interface IResearch extends Document {
  research_id: string;
  lead_id: string;
  company_id: string;
  likely_pain_point?: string;
  relevant_service?: string;
  evidence?: string;
  signals?: string;
  source?: string;
  status: string;
  summary?: string;
}

const researchSchema = new Schema({
  research_id: { type: String, required: true, unique: true },
  lead_id: { type: String, required: true, unique: true },
  company_id: { type: String, required: true },
  likely_pain_point: { type: String },
  relevant_service: { type: String },
  evidence: { type: String },
  signals: { type: String },
  source: { type: String },
  status: { type: String, default: 'draft' },
  summary: { type: String }
}, { timestamps: true });

export const Research = mongoose.model<IResearch>('Research', researchSchema);
