import mongoose, { Schema, Document } from 'mongoose';

export interface IService extends Document {
  service_id: string;
  name: string;
  price_min?: number;
  price_max?: number;
  recurring: boolean;
  recurring_price?: number;
  is_active: boolean;
}

const serviceSchema = new Schema({
  service_id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  price_min: { type: Number },
  price_max: { type: Number },
  recurring: { type: Boolean, default: false },
  recurring_price: { type: Number },
  is_active: { type: Boolean, default: true }
}, { timestamps: true });

export const Service = mongoose.model<IService>('Service', serviceSchema);
