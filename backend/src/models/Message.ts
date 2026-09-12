import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage extends Document {
  message_id: string;
  conversation_id: string;
  lead_id: string;
  contact_id: string;
  opportunity_id?: string;
  channel: string;
  direction: string;
  purpose: string;
  subject?: string;
  body: string;
  status: string;
  provider_message_id?: string;
  sequence_step: number;
  idempotency_key?: string;
  sent_at?: Date;
  error?: string;
}

const messageSchema = new Schema({
  message_id: { type: String, required: true, unique: true },
  conversation_id: { type: String, required: true },
  lead_id: { type: String, required: true },
  contact_id: { type: String, required: true },
  opportunity_id: { type: String },
  channel: { type: String, required: true },
  direction: { type: String, required: true },
  purpose: { type: String },
  subject: { type: String },
  body: { type: String, required: true },
  status: { type: String, required: true },
  provider_message_id: { type: String },
  sequence_step: { type: Number, default: 0 },
  idempotency_key: { type: String },
  sent_at: { type: Date },
  error: { type: String }
}, { timestamps: true });

export const Message = mongoose.model<IMessage>('Message', messageSchema);
