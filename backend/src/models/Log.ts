import mongoose, { Schema, Document } from 'mongoose';

export interface ILog extends Document {
  execution_id: string;
  workflow: string;
  entity_id: string;
  action: string;
  result: string;
  error: string;
  severity: string;
  human_approval: boolean;
  event_id: string;
  log_time: Date;
}

const logSchema = new Schema({
  execution_id: { type: String, required: true },
  workflow: { type: String, required: true },
  entity_id: { type: String, required: true },
  action: { type: String, required: true },
  result: { type: String, required: true },
  error: { type: String, default: '' },
  severity: { type: String, required: true },
  human_approval: { type: Boolean, required: true },
  event_id: { type: String, default: '' },
  log_time: { type: Date, required: true, default: Date.now }
}, { timestamps: true });

export const Log = mongoose.model<ILog>('Log', logSchema);
