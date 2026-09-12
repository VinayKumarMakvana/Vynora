import mongoose, { Schema, Document } from 'mongoose';

export interface IAnalytics extends Document {
  snapshot_id: string;
  period: string;
  revenue_target: number;
  closed_revenue: number;
  target_gap: number;
  weighted_pipeline: number;
  open_opportunities: number;
  conversion_rate: number;
  avg_deal_value: number;
  required_leads: number;
  required_opportunities: number;
  required_conversations: number;
  required_outreach: number;
  cost_total: number;
  gross_profit: number;
  gross_margin: number;
  net_profit: number;
  net_target: number;
  net_target_gap: number;
  directive: string;
  notes: string;
}

const analyticsSchema = new Schema({
  snapshot_id: { type: String, required: true, unique: true },
  period: { type: String, required: true },
  revenue_target: { type: Number, default: 0 },
  closed_revenue: { type: Number, default: 0 },
  target_gap: { type: Number, default: 0 },
  weighted_pipeline: { type: Number, default: 0 },
  open_opportunities: { type: Number, default: 0 },
  conversion_rate: { type: Number, default: 0 },
  avg_deal_value: { type: Number, default: 0 },
  required_leads: { type: Number, default: 0 },
  required_opportunities: { type: Number, default: 0 },
  required_conversations: { type: Number, default: 0 },
  required_outreach: { type: Number, default: 0 },
  cost_total: { type: Number, default: 0 },
  gross_profit: { type: Number, default: 0 },
  gross_margin: { type: Number, default: 0 },
  net_profit: { type: Number, default: 0 },
  net_target: { type: Number, default: 0 },
  net_target_gap: { type: Number, default: 0 },
  directive: { type: String },
  notes: { type: String }
}, { timestamps: true });

export const Analytics = mongoose.model<IAnalytics>('Analytics', analyticsSchema);
