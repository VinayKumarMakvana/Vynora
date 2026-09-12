import mongoose, { Schema, Document } from 'mongoose';

export interface IConversation extends Document {
  conversation_id: string;
  lead_id?: string;
  contact_id?: string;
  opportunity_id?: string;
  channel: string;
  intent?: string;
  sentiment?: string;
  pain_point?: string;
  buying_signals?: string;
  next_best_action?: string;
  stage?: string;
  status: string;
  last_message_at?: Date;
}

const conversationSchema = new Schema({
  conversation_id: { type: String, required: true, unique: true },
  lead_id: { type: String },
  contact_id: { type: String },
  opportunity_id: { type: String },
  channel: { type: String, required: true, default: 'email' },
  intent: { type: String },
  sentiment: { type: String },
  pain_point: { type: String },
  buying_signals: { type: String },
  next_best_action: { type: String },
  stage: { type: String },
  status: { type: String, default: 'open' },
  last_message_at: { type: Date }
}, { timestamps: true });

export const Conversation = mongoose.model<IConversation>('Conversation', conversationSchema);
