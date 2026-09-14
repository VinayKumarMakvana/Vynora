import mongoose, { Schema, Document } from 'mongoose';

export interface ILead extends Document {
  lead_id: string;
  company_id: string;
  contact_id: string;
  opportunity_id?: string;
  status: string;
  stage: string;
  qualification_status: string;
  outreach_eligible: boolean;
  bdm_owner?: string;
  last_contact_date?: Date;
  next_followup_date?: Date;
  notes?: string;
  // Sourcing fields
  raw_name?: string;
  company?: string;
  domain?: string;
  category?: string;
  dedupe_key?: string;
  lead_source?: string;
  source?: string;
}

const leadSchema = new Schema({
  lead_id: { type: String, required: true, unique: true },
  company_id: { type: String, required: true, index: true },
  contact_id: { type: String, required: true, index: true },
  opportunity_id: { type: String, index: true },
  status: { type: String, required: true, default: 'new', index: true },
  stage: { type: String, required: true, default: 'new', index: true },
  qualification_status: { type: String },
  outreach_eligible: { type: Boolean, default: false, index: true },
  bdm_owner: { type: String },
  last_contact_date: { type: Date },
  next_followup_date: { type: Date },
  notes: { type: String },
  raw_name: { type: String },
  company: { type: String },
  domain: { type: String },
  category: { type: String },
  dedupe_key: { type: String, index: true },
  lead_source: { type: String },
  source: { type: String }
}, { timestamps: true });

leadSchema.index({ status: 1, outreach_eligible: 1 }); // Compound index for outboundMachine
leadSchema.index({ qualification_status: 1, outreach_eligible: 1 });
leadSchema.index({ createdAt: -1 });

export const Lead = mongoose.model<ILead>('Lead', leadSchema);
