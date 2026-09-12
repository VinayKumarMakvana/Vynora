import mongoose, { Schema, Document } from 'mongoose';

export interface ICompany extends Document {
  company_id: string;
  name: string;
  domain: string;
  industry?: string;
  country?: string;
  website?: string;
  size?: string;
}

const companySchema = new Schema({
  company_id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  domain: { type: String, required: true },
  industry: { type: String },
  country: { type: String },
  website: { type: String },
  size: { type: String }
}, { timestamps: true });

export const Company = mongoose.model<ICompany>('Company', companySchema);
