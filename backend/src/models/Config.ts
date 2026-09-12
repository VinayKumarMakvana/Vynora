import mongoose, { Schema, Document } from 'mongoose';

export interface IConfig extends Document {
  category: string;
  is_active: boolean;
  config_key: string;
  config_value: string;
}

const configSchema = new Schema({
  category: { type: String, required: true },
  is_active: { type: Boolean, required: true, default: true },
  config_key: { type: String, required: true, unique: true },
  config_value: { type: String, required: true }
}, { timestamps: true });

export const Config = mongoose.model<IConfig>('Config', configSchema);
