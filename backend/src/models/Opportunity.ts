import mongoose, { Schema, Document } from 'mongoose';

export interface IOpportunity extends Document {
  opportunity_id: string;
  lead_id: string;
  service: string;
  stage: string;
  bdm?: string;
  discovery_date?: Date;
  scope_status: string;
  proposal_status: string;
  contract_status: string;
  payment_status: string;
  final_price?: number;
}

const opportunitySchema = new Schema({
  opportunity_id: { type: String, required: true, unique: true },
  lead_id: { type: String, required: true, index: true },
  service: { type: String, required: true },
  stage: { type: String, required: true, index: true },
  bdm: { type: String },
  discovery_date: { type: Date },
  scope_status: { type: String, default: 'Not Started' },
  proposal_status: { type: String, default: 'Not Started' },
  contract_status: { type: String, default: 'Not Started', index: true },
  payment_status: { type: String, default: 'None', index: true },
  final_price: { type: Number }
}, { timestamps: true });

export const Opportunity = mongoose.model<IOpportunity>('Opportunity', opportunitySchema);
