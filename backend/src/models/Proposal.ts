import mongoose, { Schema, Document } from 'mongoose';

export interface IProposal extends Document {
  proposal_id: string;
  opportunity_id: string;
  lead_id: string;
  requirement_id: string;
  scope?: string;
  deliverables?: string;
  timeline?: string;
  price?: number;
  price_tier?: string;
  payment_terms?: string;
  recurring_services?: string;
  approval_status: string;
  acceptance_status: string;
  status: string;
  validity_date?: Date;
}

const proposalSchema = new Schema({
  proposal_id: { type: String, required: true, unique: true },
  opportunity_id: { type: String, required: true },
  lead_id: { type: String, required: true },
  requirement_id: { type: String, required: true },
  scope: { type: String },
  deliverables: { type: String },
  timeline: { type: String },
  price: { type: Number },
  price_tier: { type: String },
  payment_terms: { type: String },
  recurring_services: { type: String },
  approval_status: { type: String, default: 'pending' },
  acceptance_status: { type: String, default: 'pending' },
  status: { type: String, default: 'draft' },
  validity_date: { type: Date }
}, { timestamps: true });

export const Proposal = mongoose.model<IProposal>('Proposal', proposalSchema);
