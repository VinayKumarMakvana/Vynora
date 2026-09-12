import mongoose, { Schema, Document } from 'mongoose';

export interface IFollowup extends Document {
  followup_id: string;
  lead_id: string;
  contact_id: string;
  conversation_id: string;
  channel: string;
  sequence_step: number;
  last_sent_at?: Date;
  scheduled_at?: Date;
  status: string;
  reason?: string;
  created_at: Date;
  updated_at: Date;
}

const FollowupSchema: Schema = new Schema({
  followup_id: { type: String, required: true, unique: true },
  lead_id: { type: String, required: true },
  contact_id: { type: String, required: true },
  conversation_id: { type: String, required: true },
  channel: { type: String, default: 'email' },
  sequence_step: { type: Number, required: true },
  last_sent_at: { type: Date },
  scheduled_at: { type: Date },
  status: { type: String, default: 'scheduled' },
  reason: { type: String }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const Followup = mongoose.model<IFollowup>('Followup', FollowupSchema);
