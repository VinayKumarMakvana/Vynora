import axios from 'axios';
import nodemailer from 'nodemailer';
import { Config } from '../models/Config';
import { Log } from '../models/Log';
import { Lead } from '../models/Lead';
import { Company } from '../models/Company';
import { Opportunity } from '../models/Opportunity';
import { Proposal } from '../models/Proposal';
import { Approval } from '../models/Approval';

interface CloseDealPayload {
  opportunity_id?: string;
  lead_id?: string;
  proposal_id?: string;
  acceptance_evidence?: string;
  evidence?: string;
  evidence_ref?: string;
  evidence_url?: string;
  proof?: string;
  source?: string;
  signal?: string;
  message?: string;
  text?: string;
}

export class ClosingEngineService {
  private async getConfig() {
    const configs = await Config.find({ is_active: true });
    const cfg: Record<string, string> = {};
    configs.forEach(c => cfg[c.config_key] = c.config_value);
    
    return {
      price_min: Number(cfg.price_min) || 500,
      price_max: Number(cfg.price_max) || 3000,
      currency: cfg.currency || 'USD',
      approval_email: process.env.APPROVAL_EMAIL || cfg.approval_email,
      finance_url: process.env.BASE_URL ? `${process.env.BASE_URL}/api/vynora/finance` : 'http://localhost:3000/api/vynora/finance'
    };
  }

  private async logEvent(execution_id: string, entity_id: string, action: string, result: string, severity: string, error = '', human_approval = false) {
    await Log.create({
      execution_id, workflow: 'VYNORA-W14-Closing-Engine', entity_id, action, result, severity, error, human_approval, log_time: new Date()
    } as any);
  }

  private async sendEmail(to: string, subject: string, text: string) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
      });
      const info = await transporter.sendMail({ from: process.env.GMAIL_USER, to, subject, text });
      return { success: true, messageId: info.messageId };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async processCloseDeal(payload: CloseDealPayload) {
    const execution_id = `exec-close-${Date.now()}`;
    const cfg = await this.getConfig();

    const opportunity_id_req = payload.opportunity_id || '';
    const lead_id_req = payload.lead_id || '';
    const valid = opportunity_id_req.length > 0 || lead_id_req.length > 0;

    if (!valid) {
      await this.logEvent(execution_id, 'unknown', 'Invalid close request rejected: Missing opportunity_id and lead_id', 'Invalid', 'Medium');
      return { status: 'error', error: 'Missing opportunity_id and lead_id' };
    }

    const evidence = (payload.acceptance_evidence || payload.evidence || '').toLowerCase().trim();
    const strongSet = ['signed_contract', 'payment_confirmed', 'signed', 'contract_signed'];
    const weakSet = ['written_acceptance', 'written', 'verbal', 'email', 'reply'];
    
    let evidence_class = 'none';
    if (strongSet.includes(evidence)) evidence_class = 'strong';
    else if (weakSet.includes(evidence)) evidence_class = 'weak';
    else if (evidence.length > 0) evidence_class = 'weak';

    const evidence_ref = payload.evidence_ref || payload.evidence_url || payload.proof || '';
    const source = payload.source || 'unknown';
    const signal = payload.signal || 'acceptance';
    const message = payload.message || payload.text || '';

    const opp = await Opportunity.findOne({ opportunity_id: opportunity_id_req });
    const prop = await Proposal.findOne({ opportunity_id: opportunity_id_req }).sort({ created_at: -1 });
    const lead = await Lead.findOne({ opportunity_id: opportunity_id_req }) || await Lead.findOne({ lead_id: lead_id_req });
    const company = await Company.findOne({ company_id: lead?.company_id });

    const opp_ok = !!opp && !!opp.opportunity_id;
    const prop_ok = !!prop && !!prop.proposal_id;
    const context_ok = opp_ok && prop_ok;

    const opportunity_id = opportunity_id_req || opp?.opportunity_id || lead?.opportunity_id || '';
    const lead_id = lead_id_req || lead?.lead_id || opp?.lead_id || '';
    const proposal_id = prop?.proposal_id || payload.proposal_id || '';

    let price = Number(String(prop?.price).replace(/[^0-9.]/g, ''));
    if (!isFinite(price)) price = 0;
    const has_price = price > 0;
    const in_range = price >= cfg.price_min && price <= cfg.price_max;

    const stage = (opp?.stage || '').toLowerCase();
    const contract_status = (opp?.contract_status || '').toLowerCase();
    const acceptance_status = (prop?.acceptance_status || '').toLowerCase();
    
    const isWon = (x: string) => { const t = x.toLowerCase(); return t === 'won' || t === 'approved' || t === 'signed' || t === 'closed won'; };
    const already_won = isWon(contract_status) || acceptance_status === 'accepted' || isWon(stage);

    let route = '';
    let reason = '';
    if (!context_ok) { route = 'missing_context'; reason = 'opportunity or sent proposal not found'; }
    else if (already_won) { route = 'already_closed'; reason = 'opportunity already Won / proposal already Accepted'; }
    else if (!has_price) { route = 'invalid'; reason = 'proposal has no valid price'; }
    else if (!in_range) { route = 'approval'; reason = `proposal price ${price} outside allowed range ${cfg.price_min}-${cfg.price_max}`; }
    else if (evidence_class === 'strong') { route = 'close'; reason = `verifiable acceptance artifact provided (${evidence})`; }
    else { route = 'approval'; reason = `acceptance evidence is ${evidence_class} (${evidence}) — human confirmation required before Closed Won`; }

    if (route === 'close') {
      await Proposal.findOneAndUpdate({ proposal_id }, { acceptance_status: 'Accepted', accepted_at: new Date(), status: 'Accepted' } as any);
      await Opportunity.findOneAndUpdate({ opportunity_id }, { stage: 'Closed Won', contract_status: 'Won', proposal_status: 'Accepted', final_price: price } as any);
      if (lead_id) {
        await Lead.findOneAndUpdate({ lead_id }, { stage: 'Closed Won', status: 'won' } as any);
      }

      try {
        await axios.post(cfg.finance_url, { action: 'payment_request', opportunity_id, stage: 'upfront' });
        await this.logEvent(execution_id, opportunity_id, `Deal Closed Won (${evidence}); upfront payment requested from W04 at ${cfg.currency} ${price}`, 'Closed Won', 'Low');
        return { status: 'closed_won', opportunity_id, final_price: price, upfront_requested: true };
      } catch (e: any) {
        await this.sendEmail(cfg.approval_email, `[VYNORA] Deal Won but payment handoff failed — ${opportunity_id}`, `The deal was correctly marked Closed Won, but the upfront payment request could not be handed to W04 Finance. No payment has been requested yet.\n\nOpportunity: ${opportunity_id}\nFinal price: ${cfg.currency} ${price}\n\nPlease re-send a payment_request (stage=upfront) to W04, or retry this close.`);
        await this.logEvent(execution_id, opportunity_id, 'Deal Closed Won but W04 payment handoff failed — upfront payment NOT requested; safe to retry', 'Handoff Failed', 'High', 'Finance webhook call failed', true);
        return { status: 'closed_won_payment_pending', reason: 'finance_handoff_failed', opportunity_id };
      }
    } else if (route === 'approval') {
      const approval_id = `APR-CLOSE-${opportunity_id}`;
      await Approval.findOneAndUpdate({ approval_id }, {
        approval_id, entity_type: 'close', entity_id: proposal_id, opportunity_id, reason,
        requested_action: `Confirm Closed Won for ${opportunity_id} at ${cfg.currency} ${price}, then re-send close-deal with acceptance_evidence=signed_contract`,
        details: `Evidence: ${evidence} (${evidence_class}). Source: ${source}. Message: ${message}`,
        status: 'Pending'
      } as any, { upsert: true });

      await this.sendEmail(cfg.approval_email, `[VYNORA] Confirm deal before Closed Won — ${company?.name || 'unknown'} (${opportunity_id})`, `An acceptance signal arrived but it is NOT a verifiable artifact, so the deal was NOT auto-closed. Please confirm the win.\n\nReason: ${reason}\nCompany: ${company?.name}\nOpportunity: ${opportunity_id}\nProposal price: ${cfg.currency} ${price}\nEvidence: ${evidence} (${evidence_class})\nSource: ${source}\n\nProspect message:\n${message}\n\nOnce confirmed (signed contract / verified deposit), re-send the close-deal request with acceptance_evidence=signed_contract to close and request the upfront payment.`);
      
      await Opportunity.findOneAndUpdate({ opportunity_id }, { stage: 'Closing', contract_status: 'Pending Confirmation' } as any);
      await this.logEvent(execution_id, opportunity_id, `Close escalated to human confirmation: ${reason}`, 'Pending Confirmation', 'Medium', '', true);
      return { status: 'pending_confirmation', reason, opportunity_id };
    } else if (route === 'already_closed') {
      await this.logEvent(execution_id, opportunity_id, 'Duplicate close ignored — opportunity already Closed Won (no reopen, accepted_at preserved)', 'Skipped', 'Low');
      return { status: 'already_closed', opportunity_id };
    } else if (route === 'missing_context') {
      await this.sendEmail(cfg.approval_email, `[VYNORA] Close blocked — context not found (${opportunity_id})`, `A close-deal request could not be processed because the opportunity or its sent proposal was not found.\n\nOpportunity: ${opportunity_id}\nOpportunity found: ${opp_ok}\nProposal found: ${prop_ok}\n\nNothing was closed.`);
      await this.logEvent(execution_id, opportunity_id, 'Close request could not be processed — opportunity/proposal not found', 'Missing Context', 'Medium', '', true);
      return { status: 'error', reason: 'missing_context', opportunity_id };
    } else if (route === 'invalid') {
      await this.logEvent(execution_id, opportunity_id, `Close blocked — ${reason}`, 'Invalid', 'Medium');
      return { status: 'error', reason, opportunity_id };
    }
  }
}

export const closingEngineService = new ClosingEngineService();
