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
  conversation_id: { type: String, required: true, index: true },
  lead_id: { type: String, required: true, index: true },
  contact_id: { type: String, required: true, index: true },
  opportunity_id: { type: String, index: true },
  channel: { type: String, required: true },
  direction: { type: String, required: true, index: true },
  purpose: { type: String },
  subject: { type: String },
  body: { type: String, required: true },
  status: { type: String, required: true, index: true },
  provider_message_id: { type: String },
  sequence_step: { type: Number, default: 0 },
  idempotency_key: { type: String, index: true },
  sent_at: { type: Date },
  error: { type: String }
}, { timestamps: true });

messageSchema.index({ direction: 1, status: 1 });

export const Message = mongoose.model<IMessage>('Message', messageSchema);
