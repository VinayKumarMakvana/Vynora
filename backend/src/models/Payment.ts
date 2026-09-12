import mongoose, { Schema, Document } from 'mongoose';

export interface IPayment extends Document {
  payment_id: string;
  event_id: string;
  opportunity_id: string;
  project_id?: string;
  event_type: string;
  amount: number;
  currency: string;
  status: string;
  provider: string;
}

const paymentSchema = new Schema({
  payment_id: { type: String, required: true, unique: true },
  event_id: { type: String, required: true },
  opportunity_id: { type: String, required: true },
  project_id: { type: String },
  event_type: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'USD' },
  status: { type: String, required: true },
  provider: { type: String, required: true }
}, { timestamps: true });

export const Payment = mongoose.model<IPayment>('Payment', paymentSchema);
