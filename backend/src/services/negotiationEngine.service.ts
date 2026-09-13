import axios from 'axios';
import nodemailer from 'nodemailer';
import { Config } from '../models/Config';
import { Log } from '../models/Log';
import { Lead } from '../models/Lead';
import { Contact } from '../models/Contact';
import { Company } from '../models/Company';
import { Message } from '../models/Message';
import { Opportunity } from '../models/Opportunity';
import { Proposal } from '../models/Proposal';
import { Conversation } from '../models/Conversation';
import { Approval } from '../models/Approval';
import { aiGatewayService } from './aiGateway.service';
import { mailerService } from './mailer.service';
import crypto from 'crypto';

interface NegotiatePayload {
  action?: string;
  opportunity_id?: string;
  lead_id?: string;
  proposal_id?: string;
  contact_id?: string;
  message?: string;
  source?: string;
  signal?: string;
  event_id?: string;
  
  approval_id?: string;
  decision?: string;
  decided_by?: string;
  decision_notes?: string;
}

export class NegotiationEngineService {
  private async getConfig() {
    const configs = await Config.find({ is_active: true });
    const cfg: Record<string, string> = {};
    configs.forEach(c => cfg[c.config_key] = c.config_value);
    
    return {
      price_min: Number(cfg.price_min) || 500,
      price_max: Number(cfg.price_max) || 3000,
      discount_max_percent: Number(cfg.discount_max_percent) || 10,
      currency: cfg.currency || 'USD',
      payment_structure: cfg.payment_structure || '50-50',
      approval_email: process.env.APPROVAL_EMAIL || cfg.approval_email,
      bdm_owner_default: cfg.bdm_owner_default || 'Vynora BDM',
      w03_url: process.env.BASE_URL ? `${process.env.BASE_URL}/api/vynora/meeting-scope` : 'http://localhost:3000/api/vynora/meeting-scope',
      w14_url: process.env.BASE_URL ? `${process.env.BASE_URL}/api/vynora/close-deal` : 'http://localhost:3000/api/vynora/close-deal'
    };
  }

  private hashStr(str: string) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36);
  }

  private async logEvent(execution_id: string, entity_id: string, action: string, result: string, severity: string, error = '', human_approval = false) {
    await Log.create({
      execution_id, workflow: 'VYNORA-W12-Negotiation-Engine', entity_id, action, result, severity, error, human_approval, log_time: new Date()
    } as any);
  }


  async processRequest(payload: NegotiatePayload) {
    const action = (payload.action || 'negotiate').toLowerCase();
    const is_negotiate = action === 'negotiate';
    const is_apply = action === 'apply_approval' || action === 'apply';

    if (is_negotiate) {
      return this.handleNegotiate(payload);
    } else if (is_apply) {
      return this.handleApply(payload);
    } else {
      await this.logEvent(`exec-${Date.now()}`, payload.opportunity_id || 'unknown', `Unsupported negotiation action rejected: ${action}`, 'Invalid', 'Medium');
      return { status: 'error', error: `Unsupported action: ${action}` };
    }
  }

  private async handleNegotiate(r: NegotiatePayload) {
    const execution_id = `exec-nego-${Date.now()}`;
    const cfg = await this.getConfig();

    const opp_id = r.opportunity_id || '';
    const lead_id_req = r.lead_id || '';
    const msg = (r.message || '').trim();

    if ((!opp_id && !lead_id_req) || !msg) {
      const error = (!opp_id && !lead_id_req) ? 'Missing opportunity_id and lead_id' : 'Missing negotiation message';
      await this.logEvent(execution_id, opp_id || 'unknown', `Invalid negotiate request rejected: ${error}`, 'Invalid', 'Medium');
      return { status: 'error', error };
    }

    const opp = await Opportunity.findOne({ opportunity_id: opp_id });
    const prop = await Proposal.findOne({ opportunity_id: opp_id }).sort({ created_at: -1 });
    const lead_id = lead_id_req || opp?.lead_id || '';
    const lead = await Lead.findOne({ opportunity_id: opp_id }) || await Lead.findOne({ lead_id });
    
    const contact_id = r.contact_id || lead?.contact_id || '';
    const contact = await Contact.findOne({ contact_id });
    const company = await Company.findOne({ company_id: lead?.company_id });
    const conv = await Conversation.findOne({ opportunity_id: opp_id });
    const msgs = await Message.find({ opportunity_id: opp_id });

    const opp_ok = !!opp && !!opp.opportunity_id;
    const prop_ok = !!prop && !!prop.proposal_id;

    const opt_out = String(contact?.opt_out).toLowerCase() === 'true';
    const stageL = (opp?.stage || '').toLowerCase();
    const contractL = (opp?.contract_status || '').toLowerCase();
    const closed_lost = stageL.includes('lost') || contractL.includes('lost');
    const already_won = stageL === 'closed won' || contractL === 'won' || (prop?.acceptance_status || '').toLowerCase() === 'accepted';

    const event_seed = r.event_id || this.hashStr(msg);
    const nego_out_key = `NEGO-OUT-${opp_id || lead_id}-${event_seed}`;
    const nego_in_key = `NEGO-IN-${opp_id || lead_id}-${event_seed}`;

    const duplicate = msgs.some(m => m.idempotency_key === nego_out_key);

    let pre_route = 'ok';
    if (!opp_ok || !prop_ok) pre_route = 'missing_context';
    else if (already_won) pre_route = 'already_won';
    else if (closed_lost) pre_route = 'closed_lost';
    else if (opt_out) pre_route = 'opt_out';
    else if (duplicate) pre_route = 'duplicate';

    if (pre_route !== 'ok') {
      if (pre_route === 'missing_context') {
        await this.logEvent(execution_id, opp_id, 'Negotiation request could not be processed — opportunity or sent proposal not found', 'Missing Context', 'Medium', '', true);
        await mailerService.sendEmail(cfg.approval_email, `[VYNORA] Negotiation blocked — missing context (${opp_id})`, `A negotiation request could not be processed because the opportunity or its sent proposal was not found.\n\nOpportunity: ${opp_id}\nOpportunity found: ${opp_ok}\nProposal found: ${prop_ok}\n\nNothing was sent or changed.`);
        return { status: 'error', reason: 'missing_context', opportunity_id: opp_id };
      }
      if (pre_route === 'opt_out') {
        await this.logEvent(execution_id, opp_id, 'Negotiation skipped — contact has opted out; no message sent', 'Opt-Out', 'Low');
        return { status: 'suppressed', reason: 'opt_out', opportunity_id: opp_id };
      }
      if (pre_route === 'closed_lost') {
        await this.logEvent(execution_id, opp_id, 'Negotiation skipped — opportunity already Closed Lost; no reopen, no message', 'Closed Lost', 'Low');
        return { status: 'skipped', reason: 'closed_lost', opportunity_id: opp_id };
      }
      if (pre_route === 'already_won') {
        await this.logEvent(execution_id, opp_id, 'Negotiation skipped — opportunity already Closed Won; no negotiation on a won deal', 'Already Won', 'Low');
        return { status: 'skipped', reason: 'already_won', opportunity_id: opp_id };
      }
      if (pre_route === 'duplicate') {
        await this.logEvent(execution_id, opp_id, 'Duplicate negotiation event — a response for this event was already produced; skipped, no resend', 'Duplicate', 'Low');
        return { status: 'duplicate', opportunity_id: opp_id };
      }
    }

    const conversation_id = conv?.conversation_id || `CONV-${lead_id || opp_id}`;

    // Store inbound message
    await Message.findOneAndUpdate({ idempotency_key: nego_in_key }, {
      message_id: `MSG-${nego_in_key}`, conversation_id, lead_id, contact_id, opportunity_id: opp_id,
      direction: 'inbound', channel: 'email', purpose: 'negotiation', body: msg, status: 'received',
      idempotency_key: nego_in_key, sequence_step: 0
    } as any, { upsert: true });

    // Classification
    const inboundMsgs = msgs.filter(m => m.direction?.toLowerCase() === 'inbound');
    const convo_text = inboundMsgs.map(m => `[${m.subject || ''}] ${m.body || ''}`).join('\n').trim();

    let price = Number(String(prop?.price).replace(/[^0-9.]/g, ''));
    if (!isFinite(price)) price = 0;

    const classify_system_prompt = 'You are a B2B sales analyst for VYNORA. Classify a prospect negotiation message. Extract ONLY what the prospect actually said. NEVER invent prices, discounts, terms, features or commitments. If the prospect names a target price or discount, report it in the numeric fields (this is extraction, not a decision). Output ONLY a single JSON object, no markdown.';
    const classify_lines = [
      `Company: ${company?.name || ''}. Contact: ${contact?.name || ''}.`,
      `Current proposal price: ${price}. Payment terms on proposal: ${prop?.payment_terms || '50-50'}.`,
      `Proposal scope: ${prop?.scope || ''}`,
      `Proposal deliverables: ${prop?.deliverables || ''}`,
      ``,
      `Prior conversation:`,
      convo_text || '(none)',
      ``,
      `New prospect message to classify:`,
      msg,
      ``,
      `Return ONLY JSON with these keys:`,
      `{"objection_type":"too_expensive|discount_request|think_about_it|competitor_cheaper|custom_price|feature_addition|scope_increase|timeline|trust|payment_terms|custom_terms|unclear|referral","outcome":"accepted|decision_pending|lost|ongoing","sentiment":"positive|neutral|negative","requested_discount_percent":0,"requested_amount":0,"requested_payment_terms":"","is_scope_change":false,"scope_change_summary":"","requested_change_summary":"","suggested_direction":""}`,
      `Rules: objection_type MUST be exactly one of the listed values (use "unclear" if you cannot tell). outcome="accepted" ONLY for an explicit unconditional yes/verbal agreement to proceed. requested_discount_percent/requested_amount are 0 unless the prospect explicitly stated a number. is_scope_change=true only when the prospect asks for additional features or larger scope beyond the current proposal.`
    ];

    const aiRes = await aiGatewayService.processAiRequest({
      prompt: classify_lines.join('\n'), system_prompt: classify_system_prompt, temperature: 0, max_tokens: 800
    });

    if (!aiRes.success) {
      await this.logEvent(execution_id, opp_id, 'Negotiation deferred — AI unavailable; message stored, no fabricated reply sent, held for human/retry', 'AI Unavailable', 'Medium', aiRes.error, true);
      await mailerService.sendEmail(cfg.approval_email, `[VYNORA] Negotiation reply deferred — AI unavailable (${opp_id})`, `A prospect negotiation message arrived but the AI classifier/drafter is unavailable, so no automated reply was generated or sent. The message is stored and the opportunity is held pending.\n\nOpportunity: ${opp_id}\nProspect: ${contact?.name} <${contact?.email}>\n\nProspect message:\n${msg}\n\nPlease reply manually or retry once AI is available.`);
      await Opportunity.findOneAndUpdate({ opportunity_id: opp_id }, { stage: 'Negotiation', proposal_status: 'Negotiation Pending (AI)' } as any);
      return { status: 'deferred', reason: 'ai_unavailable', opportunity_id: opp_id };
    }

    let k: any = {};
    try {
      let text = aiRes.text;
      const s1 = text.indexOf('{'); const e1 = text.lastIndexOf('}');
      if (s1 !== -1 && e1 !== -1 && e1 > s1) text = text.slice(s1, e1 + 1);
      k = JSON.parse(text);
    } catch(e) {}

    const validTypes = ['too_expensive','discount_request','think_about_it','competitor_cheaper','custom_price','feature_addition','scope_increase','timeline','trust','payment_terms','custom_terms','unclear','referral'];
    let objection_type = String(k.objection_type || '').toLowerCase();
    if (!validTypes.includes(objection_type)) objection_type = 'unclear';
    let outcome = String(k.outcome || '').toLowerCase();
    if (!['accepted','decision_pending','lost','ongoing'].includes(outcome)) outcome = 'ongoing';
    
    const reqAmount = Number(String(k.requested_amount).replace(/[^0-9.]/g,'')) || 0;
    const reqPct = Number(String(k.requested_discount_percent).replace(/[^0-9.]/g,'')) || 0;
    const isScope = k.is_scope_change === true || String(k.is_scope_change) === 'true' || objection_type === 'feature_addition' || objection_type === 'scope_increase';

    const reqTerms = String(k.requested_payment_terms || '').toLowerCase().replace(/[^0-9a-z]/g,'');
    const isDefaultTerms = reqTerms === '' || reqTerms.includes('5050') || reqTerms.includes('50upfront50');

    let effPrice = price;
    if (reqAmount > 0) effPrice = reqAmount;
    else if (reqPct > 0 && price > 0) effPrice = Math.round(price * (1 - reqPct / 100));
    const effDiscountPct = (price > 0 && effPrice < price) ? Math.round((price - effPrice) / price * 100) : 0;
    const hasPriceAsk = reqAmount > 0 || reqPct > 0 || objection_type === 'discount_request' || objection_type === 'custom_price';

    let nego_route = 'respond_safe';
    let concession = false;
    let allowed_price = price;
    let authority_reason = '';

    if (outcome === 'accepted') {
      nego_route = 'verbal_yes'; authority_reason = 'prospect gave explicit verbal agreement to proceed';
    } else if (isScope) {
      nego_route = 'scope_change'; authority_reason = 'prospect requested additional features / larger scope — route to W03 for re-scope and W06 revision';
    } else if (!isDefaultTerms) {
      nego_route = 'approval'; authority_reason = `prospect requested non-default payment terms (${k.requested_payment_terms || 'custom'}) — 50/50 is the default and cannot be changed without human approval`;
    } else if (objection_type === 'custom_terms') {
      nego_route = 'approval'; authority_reason = 'prospect requested custom commercial terms — requires human approval';
    } else if (objection_type === 'referral') {
      nego_route = 'human_review'; authority_reason = 'partner/referral opportunity — requires human handling';
    } else if (objection_type === 'unclear') {
      nego_route = 'human_review'; authority_reason = 'negotiation request is unclear — human review required';
    } else if (outcome === 'lost') {
      nego_route = 'human_review'; authority_reason = 'prospect signalled decline — human review before any close-lost decision (never auto-closed here)';
    } else if (hasPriceAsk) {
      if (effPrice <= 0) { nego_route = 'approval'; authority_reason = 'price request could not be evaluated deterministically'; }
      else if (effPrice < cfg.price_min) { nego_route = 'approval'; authority_reason = `requested price ${effPrice} is below configured minimum ${cfg.price_min}`; }
      else if (effPrice > cfg.price_max) { nego_route = 'approval'; authority_reason = `requested price ${effPrice} is above configured maximum ${cfg.price_max}`; }
      else if (effDiscountPct > cfg.discount_max_percent) { nego_route = 'approval'; authority_reason = `requested discount ${effDiscountPct}% exceeds configured discount authority ${cfg.discount_max_percent}%`; }
      else { nego_route = 'respond_safe'; concession = effDiscountPct > 0; allowed_price = effPrice; authority_reason = `discount ${effDiscountPct}% within authority ${cfg.discount_max_percent}% and price ${effPrice} within band — safe counter`; }
    } else {
      nego_route = 'respond_safe'; concession = false; allowed_price = price; authority_reason = `objection handled with value/reassurance response, no price change (${objection_type})`;
    }

    if (nego_route === 'respond_safe') {
      const concessionLine = concession
        ? `You MAY offer an adjusted total price of exactly ${cfg.currency} ${allowed_price} (this is the ONLY price you may state; do not go lower). Payment terms remain 50% upfront and 50% on delivery via Binance (preferred) or PayPal.`
        : `Do NOT change the price. Keep the total at ${cfg.currency} ${price} and payment terms at 50% upfront / 50% on delivery via Binance (preferred) or PayPal. Address the concern with value, clarity and reassurance only.`;
      
      const draft_sys_prompt = `You are the founder of VYNORA replying to a prospect during negotiation. Use ONLY the facts provided. NEVER invent capabilities, discounts, prices, timelines or commitments. NEVER change the payment structure. Stay strictly within the commercial constraints given. End with exactly this sign-off and nothing after it:\nVinay Kumar Makvana\nFounder, VYNORA\nDirect Contact: ${process.env.CONTACT_EMAIL}`;
      const draft_lines = [
        `Write a concise, warm, professional reply. Return ONLY JSON: {"subject":"...","body_html":"..."} where body_html is a valid HTML email body.`,
        `Prospect: ${contact?.name || 'there'} at ${company?.name || ''}`,
        `Service: ${opp?.service || ''}`,
        `Their message / objection: ${msg}`,
        `Objection type: ${objection_type}`,
        `Current proposal scope: ${prop?.scope || ''}`,
        `Current total price: ${cfg.currency} ${price}`,
        `Commercial constraint you MUST obey: ${concessionLine}`,
        `Do not mention internal policy, discount authority, or that approval was involved. Keep under 220 words. Invite them to proceed with the 50/50 structure.`
      ];

      const aiDraft = await aiGatewayService.processAiRequest({ prompt: draft_lines.join('\n'), system_prompt: draft_sys_prompt, temperature: 0.4, max_tokens: 1200 });
      let subject = ''; let body_html = '';
      if (aiDraft.success) {
        let text = aiDraft.text;
        const s1 = text.indexOf('{'); const e1 = text.lastIndexOf('}');
        if (s1 !== -1 && e1 !== -1 && e1 > s1) text = text.slice(s1, e1 + 1);
        try { const j = JSON.parse(text); subject = j.subject || ''; body_html = j.body_html || ''; } catch (e) {}
      }

      if (aiDraft.success && subject && body_html && contact?.email) {
        const emailRes = await mailerService.sendEmail(contact.email, subject, body_html, body_html);
        if (emailRes.success) {
          await Message.create({
            message_id: `MSG-${nego_out_key}`, conversation_id, lead_id, contact_id, opportunity_id: opp_id,
            direction: 'outbound', channel: 'email', purpose: 'negotiation', subject, body: body_html, status: 'sent',
            provider_message_id: emailRes.messageId, idempotency_key: nego_out_key, sent_at: new Date(), sequence_step: 0
          } as any);
          await Conversation.findOneAndUpdate({ conversation_id }, {
            conversation_id, lead_id, contact_id, opportunity_id: opp_id, channel: 'email', stage: 'negotiation',
            objections: objection_type, next_best_action: 'Await prospect decision on negotiation reply', status: 'open', last_message_at: new Date()
          } as any, { upsert: true });
          await Opportunity.findOneAndUpdate({ opportunity_id: opp_id }, { stage: 'Negotiation' } as any);
          await this.logEvent(execution_id, opp_id, `Negotiation reply sent (${objection_type}); ${authority_reason}`, 'Responded', 'Low');
          return { status: 'responded', route: 'respond_safe', opportunity_id: opp_id, objection_type };
        } else {
          await Message.create({
            message_id: `MSG-${nego_out_key}-failed`, conversation_id, lead_id, contact_id, opportunity_id: opp_id,
            direction: 'outbound', channel: 'email', purpose: 'negotiation', subject, body: body_html, status: 'failed',
            idempotency_key: nego_out_key, sequence_step: 0, error: 'Gmail send failed'
          } as any);
          await this.logEvent(execution_id, opp_id, 'Negotiation reply send failed — not marked sent; safe to retry', 'Send Failed', 'High', 'Gmail send failed');
          return { status: 'send_failed', opportunity_id: opp_id };
        }
      } else {
        await mailerService.sendEmail(cfg.approval_email, `[VYNORA] Negotiation reply needs a human — ${company?.name} (${opp_id})`, `A negotiation reply was authorised within commercial rules but no usable draft could be generated (AI/draft unavailable). No message was sent to the prospect.\n\nOpportunity: ${opp_id}\nObjection: ${objection_type}\nAuthority: ${authority_reason}\nProspect message:\n${msg}\n\nPlease reply manually or retry.`);
        await this.logEvent(execution_id, opp_id, 'Negotiation reply authorised but draft unavailable — routed to human, prospect NOT emailed', 'Draft Deferred', 'Medium', aiDraft.error, true);
        return { status: 'draft_deferred', opportunity_id: opp_id };
      }
    } else if (nego_route === 'scope_change') {
      await Opportunity.findOneAndUpdate({ opportunity_id: opp_id }, { stage: 'Negotiation', scope_status: 'Scope Change Requested', proposal_status: 'Revision Requested' } as any);
      try {
        await axios.post(cfg.w03_url, { opportunity_id: opp_id, lead_id, contact_id, company_id: company?.company_id, notes: `Scope change requested during negotiation: ${k.scope_change_summary || msg}`, source: 'W13-negotiation' });
        await this.logEvent(execution_id, opp_id, `Material scope change routed to W03 for re-scope + W06 revision: ${k.scope_change_summary}`, 'Scope Change', 'Low');
        return { status: 'scope_change', handed_to: 'W03', opportunity_id: opp_id };
      } catch (e: any) {
        await mailerService.sendEmail(cfg.approval_email, `[VYNORA] Scope-change handoff to W03 failed — ${opp_id}`, `A scope change was detected during negotiation but the handoff to W03 (re-scope) failed. No proposal revision was requested.\n\nOpportunity: ${opp_id}\nRequested change: ${k.scope_change_summary}\n\nPlease re-send to W03 or handle manually.`);
        await this.logEvent(execution_id, opp_id, 'Scope-change handoff to W03 failed — no revision requested; safe to retry', 'Handoff Failed', 'High', 'W03 webhook call failed', true);
        return { status: 'scope_change_handoff_failed', opportunity_id: opp_id };
      }
    } else if (nego_route === 'verbal_yes') {
      await Opportunity.findOneAndUpdate({ opportunity_id: opp_id }, { stage: 'Verbal Yes' } as any);
      try {
        await axios.post(cfg.w14_url, { opportunity_id: opp_id, lead_id, proposal_id: prop?.proposal_id, acceptance_evidence: 'verbal', source: 'W13-negotiation', signal: 'verbal_yes', message: msg });
        await this.logEvent(execution_id, opp_id, 'Verbal yes detected — handed to W14 Closing with verbal (weak) evidence; W14 requires human confirmation before Closed Won. No auto-close, no payment.', 'Verbal Yes', 'Low');
        return { status: 'verbal_yes', handed_to: 'W14', opportunity_id: opp_id };
      } catch (e: any) {
        await mailerService.sendEmail(cfg.approval_email, `[VYNORA] Verbal-yes handoff to W14 failed — ${opp_id}`, `A verbal yes was detected but the handoff to W14 Closing failed. The deal was NOT closed and no payment was requested.\n\nOpportunity: ${opp_id}\n\nPlease re-send to W14 or handle manually.`);
        await this.logEvent(execution_id, opp_id, 'Verbal-yes handoff to W14 failed — deal NOT closed; safe to retry', 'Handoff Failed', 'High', 'W14 webhook call failed', true);
        return { status: 'verbal_yes_handoff_failed', opportunity_id: opp_id };
      }
    } else if (nego_route === 'approval') {
      const approval_id = `APR-NEGO-${opp_id}-${event_seed}`;
      await Approval.findOneAndUpdate({ approval_id }, {
        approval_id, entity_type: 'negotiation', entity_id: prop?.proposal_id || '', opportunity_id: opp_id,
        requested_action: `Negotiation concession: ${objection_type} — ${k.requested_change_summary}`,
        reason: authority_reason,
        details: `Current price ${cfg.currency} ${price}; requested discount ${k.requested_discount_percent}% / amount ${k.requested_amount}; requested terms ${k.requested_payment_terms}. To approve: apply_approval with decision=approved for this approval_id.`,
        status: 'pending', approval_token: 'nego'
      } as any, { upsert: true });
      await Opportunity.findOneAndUpdate({ opportunity_id: opp_id }, { stage: 'Negotiation', proposal_status: 'Approval Pending' } as any);
      await mailerService.sendEmail(cfg.approval_email, `[VYNORA] Negotiation needs approval — ${company?.name} (${opp_id})`, `A negotiation request is outside autonomous commercial authority and needs your decision. The prospect has NOT been emailed anything.\n\nCompany: ${company?.name}\nProspect: ${contact?.name} <${contact?.email}>\nOpportunity: ${opp_id}\nObjection type: ${objection_type}\n\nCurrent price: ${cfg.currency} ${price}\nRequested discount: ${k.requested_discount_percent}%  |  Requested amount: ${k.requested_amount}\nRequested payment terms: ${k.requested_payment_terms}\nDiscount authority: ${cfg.discount_max_percent}%  |  Allowed band: ${cfg.currency} ${cfg.price_min}-${cfg.price_max}\n\nWhy approval is required: ${authority_reason}\n\nProspect message:\n${msg}\n\nApproval record: ${approval_id}\nApprove: send apply_approval (decision=approved) to negotiate webhook; Reject: decision=rejected.`);
      await this.logEvent(execution_id, opp_id, `Negotiation held for human approval: ${authority_reason}; prospect NOT emailed`, 'Approval Pending', 'Medium', '', true);
      return { status: 'approval_pending', opportunity_id: opp_id, approval_id };
    } else if (nego_route === 'human_review') {
      await mailerService.sendEmail(cfg.approval_email, `[VYNORA] Negotiation needs human review — ${company?.name} (${opp_id})`, `A negotiation message needs a human. Nothing was sent to the prospect and no commercial change was made.\n\nReason: ${authority_reason}\nObjection type: ${objection_type}\nOutcome signal: ${outcome}\nOpportunity: ${opp_id}\nProspect: ${contact?.name} <${contact?.email}>\n\nProspect message:\n${msg}`);
      await this.logEvent(execution_id, opp_id, `Negotiation routed to human review: ${authority_reason}; prospect NOT emailed`, 'Human Review', 'Medium', '', true);
      return { status: 'human_review', opportunity_id: opp_id, objection_type };
    }
  }

  private async handleApply(r: NegotiatePayload) {
    const execution_id = `exec-apply-${Date.now()}`;
    const cfg = await this.getConfig();

    const decision = r.decision === 'approve' ? 'approved' : (r.decision === 'reject' ? 'rejected' : String(r.decision).toLowerCase());
    const approval_id = r.approval_id || '';

    if (!approval_id || !['approved', 'rejected'].includes(decision)) {
      const error = !approval_id ? 'Missing approval_id' : 'decision must be approved or rejected';
      await this.logEvent(execution_id, approval_id || 'unknown', `Invalid apply_approval rejected: ${error}`, 'Invalid', 'Medium');
      return { status: 'error', error };
    }

    const appr = await Approval.findOne({ approval_id });
    const opp_id = appr?.opportunity_id || '';
    const opp = await Opportunity.findOne({ opportunity_id: opp_id });
    const prop = await Proposal.findOne({ opportunity_id: opp_id }).sort({ created_at: -1 });
    const lead_id = opp?.lead_id || '';
    const lead = await Lead.findOne({ lead_id });
    const contact = await Contact.findOne({ contact_id: lead?.contact_id });

    const appr_ok = !!appr && appr.approval_id && (appr.entity_type || '').toLowerCase() === 'negotiation';
    const prior = (appr?.status || '').toLowerCase();
    const already_applied = ['approved', 'rejected', 'applied'].includes(prior);

    const opt_out = String(contact?.opt_out).toLowerCase() === 'true';
    const stageL = (opp?.stage || '').toLowerCase();
    const contractL = (opp?.contract_status || '').toLowerCase();
    const closed = stageL.includes('lost') || contractL.includes('lost') || stageL === 'closed won' || contractL === 'won';

    let route = 'apply_send'; let reason = 'human approved — send the agreed offer to the prospect';
    if (!appr_ok) { route = 'apply_missing'; reason = 'negotiation approval record not found'; }
    else if (already_applied) { route = 'apply_already'; reason = `approval already decided (${prior}) — idempotent skip`; }
    else if (decision === 'rejected') { route = 'apply_reject'; reason = 'human rejected the requested concession'; }
    else if (opt_out) { route = 'apply_block'; reason = 'contact has opted out — approved offer cannot be sent'; }
    else if (closed) { route = 'apply_block'; reason = 'opportunity is already closed — approved offer cannot be sent'; }

    const conversation_id = `CONV-${lead_id || opp_id}`;
    const apply_out_key = `NEGO-APPLY-${opp_id}-${approval_id}`;

    if (route === 'apply_send') {
      const sys_prompt = `You are the founder of VYNORA sending a prospect the terms your team just approved during negotiation. Use ONLY the facts provided. NEVER invent capabilities or change the approved commercial terms. Payment stays 50% upfront / 50% on delivery via Binance (preferred) or PayPal. End with exactly this sign-off and nothing after it:\nVinay Kumar Makvana\nFounder, VYNORA\nDirect Contact: ${process.env.CONTACT_EMAIL}`;
      const draft_lines = [
        `Write a concise, warm confirmation reply presenting the approved terms. Return ONLY JSON: {"subject":"...","body_html":"..."}.`,
        `Prospect: ${contact?.name || 'there'}`,
        `Approved outcome: ${appr?.requested_action || ''}`,
        `Approval note from our side: ${r.decision_notes || 'approved'}`,
        `Scope: ${prop?.scope || ''}`,
        `Confirm the way forward and invite them to proceed with 50% upfront and 50% on delivery via Binance (preferred) or PayPal. Keep under 200 words.`
      ];

      const aiDraft = await aiGatewayService.processAiRequest({ prompt: draft_lines.join('\n'), system_prompt: sys_prompt, temperature: 0.4, max_tokens: 1000 });
      let subject = ''; let body_html = '';
      if (aiDraft.success) {
        let text = aiDraft.text;
        const s1 = text.indexOf('{'); const e1 = text.lastIndexOf('}');
        if (s1 !== -1 && e1 !== -1 && e1 > s1) text = text.slice(s1, e1 + 1);
        try { const j = JSON.parse(text); subject = j.subject || ''; body_html = j.body_html || ''; } catch (e) {}
      }

      if (aiDraft.success && subject && body_html && contact?.email) {
        const emailRes = await mailerService.sendEmail(contact.email, subject, body_html, body_html);
        if (emailRes.success) {
          await Message.create({
            message_id: `MSG-${apply_out_key}`, conversation_id, lead_id, contact_id: contact.contact_id, opportunity_id: opp_id,
            direction: 'outbound', channel: 'email', purpose: 'negotiation', subject, body: body_html, status: 'sent',
            provider_message_id: emailRes.messageId, idempotency_key: apply_out_key, sent_at: new Date(), sequence_step: 0
          } as any);
          await Approval.findOneAndUpdate({ approval_id }, { status: 'approved', decided_by: r.decided_by, decided_at: new Date(), decision_notes: r.decision_notes } as any);
          await Opportunity.findOneAndUpdate({ opportunity_id: opp_id }, { stage: 'Negotiation', proposal_status: 'Negotiation (Approved Offer Sent)' } as any);
          await this.logEvent(execution_id, opp_id, `Approved negotiation offer sent to prospect (${approval_id}); approval marked approved`, 'Approved Sent', 'Low', '', true);
          return { status: 'approved_offer_sent', approval_id, opportunity_id: opp_id };
        } else {
          await Message.create({
            message_id: `MSG-${apply_out_key}-failed`, conversation_id, lead_id, contact_id: contact.contact_id, opportunity_id: opp_id,
            direction: 'outbound', channel: 'email', purpose: 'negotiation', subject, body: body_html, status: 'failed',
            idempotency_key: apply_out_key, sequence_step: 0, error: 'Gmail send failed'
          } as any);
          await this.logEvent(execution_id, opp_id, 'Approved offer send failed — approval left pending, not marked applied; safe to retry', 'Send Failed', 'High', 'Gmail send failed', true);
          return { status: 'approved_send_failed', approval_id };
        }
      } else {
        await mailerService.sendEmail(cfg.approval_email, `[VYNORA] Approved offer needs manual send — ${opp_id}`, `You approved a negotiation concession but no usable draft could be generated (AI unavailable). Nothing was sent to the prospect and the approval was left pending.\n\nOpportunity: ${opp_id}\nApproved: ${appr?.requested_action}\n\nPlease send manually or retry.`);
        await this.logEvent(execution_id, opp_id, 'Approved offer draft unavailable — approval left pending, prospect NOT emailed', 'Draft Deferred', 'Medium', aiDraft.error, true);
        return { status: 'approved_draft_deferred', approval_id };
      }
    } else if (route === 'apply_reject') {
      await Approval.findOneAndUpdate({ approval_id }, { status: 'rejected', decided_by: r.decided_by, decided_at: new Date(), decision_notes: r.decision_notes } as any);
      await Opportunity.findOneAndUpdate({ opportunity_id: opp_id }, { stage: 'Negotiation', proposal_status: 'Concession Rejected' } as any);
      await mailerService.sendEmail(cfg.approval_email, `[VYNORA] Concession rejected — ${opp_id}`, `The requested negotiation concession was rejected. The rejected offer was NOT sent to the prospect and the negotiation state is preserved. Please craft a safe alternative or follow up manually.\n\nOpportunity: ${opp_id}\nApproval: ${approval_id}\nRequested: ${appr?.requested_action}\nNote: ${r.decision_notes}`);
      await this.logEvent(execution_id, opp_id, `Concession rejected (${approval_id}) — rejected offer NOT sent, negotiation state preserved, routed to human`, 'Rejected', 'Medium', '', true);
      return { status: 'rejected', approval_id, opportunity_id: opp_id };
    } else if (route === 'apply_block') {
      await mailerService.sendEmail(cfg.approval_email, `[VYNORA] Approved offer NOT sent — ${opp_id}`, `An approved negotiation offer could not be sent. Reason: ${reason}. Nothing was sent to the prospect.\n\nOpportunity: ${opp_id}\nApproval: ${approval_id}`);
      await this.logEvent(execution_id, opp_id, `Approved offer blocked — ${reason}; nothing sent`, 'Blocked', 'Medium', '', true);
      return { status: 'blocked', reason, approval_id };
    } else if (route === 'apply_missing') {
      await this.logEvent(execution_id, approval_id, 'apply_approval could not be processed — negotiation approval record not found', 'Missing Context', 'Medium', '', true);
      return { status: 'error', reason: 'approval_not_found', approval_id };
    } else if (route === 'apply_already') {
      await this.logEvent(execution_id, opp_id, `Duplicate apply_approval ignored — ${reason}`, 'Duplicate', 'Low');
      return { status: 'already_decided', approval_id };
    }
  }
}

export const negotiationEngineService = new NegotiationEngineService();
