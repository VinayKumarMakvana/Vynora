import mongoose, { Schema, Document } from 'mongoose';

export interface IProject extends Document {
  project_id: string;
  opportunity_id: string;
  client?: string;
  sow?: string;
  assigned_developer?: string;
  repository?: string;
  environment?: string;
  milestones: string;
  qa_status: string;
  deployment_status: string;
  handover_status: string;
}

const projectSchema = new Schema({
  project_id: { type: String, required: true, unique: true },
  opportunity_id: { type: String, required: true },
  client: { type: String },
  sow: { type: String },
  assigned_developer: { type: String },
  repository: { type: String },
  environment: { type: String },
  milestones: { type: String, default: 'Kickoff pending' },
  qa_status: { type: String, default: 'Not Started' },
  deployment_status: { type: String, default: 'Not Started' },
  handover_status: { type: String, default: 'Not Started' }
}, { timestamps: true });

export const Project = mongoose.model<IProject>('Project', projectSchema);
