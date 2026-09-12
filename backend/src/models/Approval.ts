import mongoose, { Schema, Document } from 'mongoose';

export interface IApproval extends Document {
  approval_id: string;
  entity_type: string;
  entity_id: string;
  opportunity_id: string;
  reason: string;
  requested_action: string;
  details: string;
  status: string;
  approval_token: string;
  decided_by?: string;
  decided_at?: Date;
  decision_notes?: string;
}

const approvalSchema = new Schema({
  approval_id: { type: String, required: true, unique: true },
  entity_type: { type: String, required: true },
  entity_id: { type: String, required: true },
  opportunity_id: { type: String, required: true },
  reason: { type: String, required: true },
  requested_action: { type: String, required: true },
  details: { type: String },
  status: { type: String, default: 'Pending' },
  approval_token: { type: String, required: true },
  decided_by: { type: String },
  decided_at: { type: Date },
  decision_notes: { type: String }
}, { timestamps: true });

export const Approval = mongoose.model<IApproval>('Approval', approvalSchema);
