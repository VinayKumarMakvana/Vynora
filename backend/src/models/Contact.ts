import mongoose, { Schema, Document } from 'mongoose';

export interface IContact extends Document {
  contact_id: string;
  name: string;
  title?: string;
  email: string;
  email_status?: string;
  opt_out: boolean;
  decision_maker: boolean;
}

const contactSchema = new Schema({
  contact_id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  title: { type: String },
  email: { type: String, required: true, index: true },
  email_status: { type: String },
  opt_out: { type: Boolean, default: false },
  decision_maker: { type: Boolean, default: false }
}, { timestamps: true });

export const Contact = mongoose.model<IContact>('Contact', contactSchema);
