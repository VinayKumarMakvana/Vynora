import mongoose, { Schema, Document } from 'mongoose';

export interface IMeeting extends Document {
  meeting_id: string;
  opportunity_id: string;
  lead_id?: string;
  contact_id?: string;
  company_id?: string;
  channel?: string;
  duration?: string;
  scheduled_at?: Date;
  timezone?: string;
  confirmation_sent?: boolean;
  reminder_sent?: boolean;
  reminder_key?: string;
  source?: string;
  notes?: string;
  discovery_status?: string;
  transcript?: string;
  recording_url?: string;
  status: string;
}

const meetingSchema = new Schema({
  meeting_id: { type: String, required: true, unique: true },
  opportunity_id: { type: String, required: true },
  lead_id: { type: String },
  contact_id: { type: String },
  company_id: { type: String },
  channel: { type: String },
  duration: { type: String },
  scheduled_at: { type: Date },
  timezone: { type: String },
  confirmation_sent: { type: Boolean, default: false },
  reminder_sent: { type: Boolean, default: false },
  reminder_key: { type: String },
  source: { type: String },
  notes: { type: String },
  discovery_status: { type: String },
  transcript: { type: String },
  recording_url: { type: String },
  status: { type: String, default: 'Completed' }
}, { timestamps: true });

export const Meeting = mongoose.model<IMeeting>('Meeting', meetingSchema);
