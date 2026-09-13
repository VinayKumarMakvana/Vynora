import { Config } from '../models/Config';
import { Lead } from '../models/Lead';
import { Opportunity } from '../models/Opportunity';
import { Contact } from '../models/Contact';
import { Company } from '../models/Company';
import { Conversation } from '../models/Conversation';
import { Requirement } from '../models/Requirement';
import { Proposal } from '../models/Proposal';
import { Message } from '../models/Message';
import { Service } from '../models/Service';
import { Approval } from '../models/Approval';
import { Log } from '../models/Log';
import { aiGatewayService } from './aiGateway.service';
import { mailerService } from './mailer.service';

export class ProposalService {
  private async getConfig() {
    const configs = await Config.find({ is_active: true });
    const cfg: Record<string, string> = {};
    configs.forEach(c => cfg[c.config_key] = c.config_value);
    const num = (k: string, d: number) => { const v = Number(cfg[k]); return isNaN(v) ? d : v; };

    return {
      price_min: num('price_min', 500),
      price_max: num('price_max', 3000),
      discount_max_percent: num('discount_max_percent', 10),
      currency: cfg.currency || 'USD',
      payment_structure: cfg.payment_structure || '50-50',
      approval_email: process.env.APPROVAL_EMAIL || cfg.approval_email,
      bdm_owner_default: cfg.bdm_owner_default || 'Vynora BDM'
    };
  }

  private async logEvent(entity_id: string, action: string, result: string, severity: string, human_approval: boolean, error?: string) {
    await Log.create({
      execution_id: `exec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      workflow: 'VYNORA-W06-Proposal-Generation',
      entity_id: entity_id || 'unknown',
      action,
      result,
      severity,
      error: error || undefined,
      human_approval,
      log_time: new Date()
    } as any);
  }


  async handleProposalIntake(body: any) {
    const cfg = await this.getConfig();
    const s = (v: any) => (v === undefined || v === null) ? '' : String(v).trim();
    
    const opportunity_id = s(body.opportunity_id);
    const email = s(body.email);
    const contact_id = s(body.contact_id);

    const valid = opportunity_id.length > 0 && (email.length > 0 || contact_id.length > 0);
    if (!valid) {
      await this.logEvent(opportunity_id || 'unknown', `Proposal intake rejected: missing opportunity_id or contact reference`, 'Rejected', 'Medium', false);
      return { status: 'error', reason: 'invalid_payload' };
    }

    const opp = await Opportunity.findOne({ opportunity_id }) as any || {};
    const lead = await Lead.findOne({ lead_id: s(body.lead_id) || opp.lead_id }) as any || {};
    const contact = await Contact.findOne({ contact_id: contact_id || lead.contact_id }) as any || {};
    const company = await Company.findOne({ company_id: s(body.company_id) || lead.company_id }) as any || {};
    const conv = await Conversation.findOne({ lead_id: lead.lead_id }) as any || {};
    const req = await Requirement.findOne({ opportunity_id }) as any || {};
    const prop = await Proposal.findOne({ opportunity_id }) as any || {};
    const msgs = await Message.find({ opportunity_id }) as any[];

    const has = (o: any) => !!(o && Object.keys(o).length);
    const opp_ok = has(opp) && !!opp.opportunity_id;
    const contact_ok = has(contact) && !!contact.contact_id;
    const prospect_email = s(contact.email) || email;
    const opt_out = contact.opt_out === true || String(contact.opt_out).toLowerCase() === 'true';

    const propStatus = String(prop.status || '').toLowerCase();
    const propAccept = String(prop.acceptance_status || '').toLowerCase();
    const proposal_already = has(prop) && (propStatus === 'sent' || propStatus === 'accepted' || propAccept === 'accepted');

    const inbound = msgs.filter(m => String(m.direction).toLowerCase() === 'inbound');
    let convo_text = inbound.map(m => `[${m.subject || ''}] ${m.body || ''}`).join('\n').trim();
    const pain_from_conv = conv.pain_point || '';
    const extra = [body.pain_points, body.summary, pain_from_conv].filter(Boolean).join(' | ');
    if (extra) convo_text = (convo_text ? convo_text + '\n' : '') + extra;
    if (!convo_text) convo_text = s(body.summary || body.pain_points || '');

    const services = await Service.find({ is_active: true }) as any[];
    const wantName = s(opp.service || body.recommended_service).toLowerCase();
    let svc = services.find(s => s.name?.toLowerCase() === wantName);
    if (!svc) {
      if (wantName.includes('landing') || wantName.includes('website') || wantName.includes('site')) svc = services.find(s => s.service_id === 'SVC-WEB');
      else if (wantName.includes('ai') || wantName.includes('automation')) svc = services.find(s => s.service_id === 'SVC-AI');
      else if (wantName.includes('integration') || wantName.includes('api')) svc = services.find(s => s.service_id === 'SVC-INT');
      else if (wantName.includes('maintenance') || wantName.includes('support')) svc = services.find(s => s.service_id === 'SVC-MNT');
      else if (wantName.includes('app') || wantName.includes('software') || wantName.includes('saas') || wantName.includes('platform')) svc = services.find(s => s.service_id === 'SVC-APP');
    }
    if (!svc) svc = services.find(s => s.service_id === 'SVC-APP') || {} as any;

    let pre_route = 'ok';
    if (!opp_ok) pre_route = 'missing_context';
    else if (proposal_already) pre_route = 'duplicate';

    const resolved_lead_id = body.lead_id || lead.lead_id || opp.lead_id || '';
    const conversation_id = s(conv.conversation_id) || `CONV-${resolved_lead_id || opportunity_id}`;
    
    const ctx = {
      pre_route, opp_ok, contact_ok, opt_out, proposal_already,
      opportunity_id, lead_id: resolved_lead_id,
      contact_id: body.contact_id || contact.contact_id || '',
      company_id: body.company_id || company.company_id || '',
      conversation_id,
      requirement_id: s(req.requirement_id) || `REQ-${opportunity_id}`,
      proposal_id: s(prop.proposal_id) || `PROP-${opportunity_id}`,
      contact_name: contact.name || body.name || '',
      prospect_email,
      company_name: company.name || body.company || '',
      industry: company.industry || '',
      bdm_owner: opp.bdm || lead.bdm_owner || body.bdm_owner || cfg.bdm_owner_default,
      service_id: svc.service_id || '', service_name: svc.name || opp.service || body.recommended_service || '',
      cat_price_min: Number(svc.price_min) || 0, cat_price_max: Number(svc.price_max) || 0,
      recurring: svc.recurring === true || String(svc.recurring).toLowerCase() === 'true',
      recurring_price: Number(svc.recurring_price) || 0,
      convo_text,
      pain_points: body.pain_points || pain_from_conv || '',
      stage: opp.stage || '', scope_status: opp.scope_status || ''
    };

    if (pre_route === 'missing_context') {
      const msg = `A proposal request could not be processed because the opportunity was not found in the CRM.\nOpportunity: ${ctx.opportunity_id}\nLead: ${ctx.lead_id}\nContact: ${ctx.contact_name} <${ctx.prospect_email}>\nNo scoping, pricing or proposal was generated.`;
      await mailerService.sendEmail(cfg.approval_email, `[VYNORA] Proposal blocked — missing CRM context (${ctx.opportunity_id})`, msg);
      await this.logEvent(ctx.opportunity_id, 'Proposal request could not be processed — opportunity not found in CRM', 'Missing Context', 'Medium', true);
      return { status: 'error', reason: 'missing_context' };
    }

    if (pre_route === 'duplicate') {
      await this.logEvent(ctx.opportunity_id, `Duplicate proposal request — proposal ${ctx.proposal_id} already sent/accepted; skipped`, 'Duplicate', 'Low', false);
      return { status: 'duplicate' };
    }

    // Process Requirements with AI
    const sysPrompt = 'You are a senior solutions architect scoping a software / AI-automation / web project for VYNORA. Extract ONLY what the prospect actually stated in the conversation. Never invent requirements, features, timelines, budgets, platforms, technologies or user counts. When something is not stated, use an empty string and record it under missing_items. Output ONLY a single JSON object, no markdown.';
    const promptLines = [
      `Extract structured requirements from this prospect conversation for ${ctx.company_name || 'the client'} (${ctx.contact_name || 'contact'}).`,
      `Recommended service line: ${ctx.service_name || 'Unknown'}.`,
      '', 'Conversation / notes:', ctx.convo_text || '(none provided)', '',
      'Return ONLY JSON with these keys:',
      '{"business_problem":"","desired_solution":"","scope":"","features":"","integrations":"","platform":"","technology":"","users":"","complexity":"low|medium|high|unknown","timeline":"","budget":"","missing_items":[],"critical_missing":false}',
      'Set critical_missing=true when business_problem, scope, or core features are absent or too vague to price. complexity must be one of low, medium, high, or unknown (use unknown when scope is unclear).'
    ];

    const aiRes = await aiGatewayService.processAiRequest({ prompt: promptLines.join('\n'), system_prompt: sysPrompt, temperature: 0, max_tokens: 1000 });
    
    let r: any = {};
    if (aiRes.success) {
      try {
        let text = String(aiRes.text).trim();
        const start = text.indexOf('{'); const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) text = text.slice(start, end + 1);
        r = JSON.parse(text);
      } catch (e) { r = {}; }
    }

    const sa = (v: any) => { if (v === undefined || v === null) return ''; if (Array.isArray(v)) return v.join('; '); return String(v).trim(); };
    const missing_arr = Array.isArray(r.missing_items) ? r.missing_items.map(String) : (r.missing_items ? [String(r.missing_items)] : []);
    
    let critical_missing = r.critical_missing === true || String(r.critical_missing).toLowerCase() === 'true';
    if (!sa(r.business_problem) && !sa(r.scope) && !sa(r.features)) critical_missing = true;

    if (!aiRes.success) {
      await Opportunity.findOneAndUpdate({ opportunity_id }, { scope_status: 'Scoping Deferred', proposal_status: 'Pending' } as any);
      await this.logEvent(ctx.opportunity_id, 'Scoping deferred — AI unavailable; no requirements/proposal generated', 'Deferred', 'Medium', false, aiRes.error || 'AI unavailable');
      return { status: 'ai_deferred' };
    }

    // Upsert Requirement
    await Requirement.findOneAndUpdate({ requirement_id: ctx.requirement_id }, {
      requirement_id: ctx.requirement_id, opportunity_id: ctx.opportunity_id, lead_id: ctx.lead_id,
      business_problem: sa(r.business_problem), desired_solution: sa(r.desired_solution),
      scope: sa(r.scope), features: sa(r.features), integrations: sa(r.integrations),
      platform: sa(r.platform), technology: sa(r.technology), users: sa(r.users),
      complexity: sa(r.complexity), timeline: sa(r.timeline), budget: sa(r.budget),
      status: critical_missing ? 'Needs Clarification' : 'Scoped'
    } as any, { upsert: true });

    if (critical_missing) {
      await Opportunity.findOneAndUpdate({ opportunity_id }, { scope_status: 'Needs Clarification', proposal_status: 'Pending', discovery_date: new Date() } as any);
      
      const msg = `Requirements were extracted but critical information is missing before this can be priced or proposed. No pricing or proposal was generated.\n\nProspect: ${ctx.contact_name} <${ctx.prospect_email}>\nService: ${ctx.service_name}\n\nMissing: ${missing_arr.join('; ')}\n\nScope so far: ${sa(r.scope)}\nFeatures: ${sa(r.features)}`;
      await mailerService.sendEmail(cfg.approval_email, `[VYNORA] Scope needs clarification — ${ctx.company_name} (${ctx.opportunity_id})`, msg);
      
      await this.logEvent(ctx.opportunity_id, `Requirements scoped but critical info missing: ${missing_arr.join('; ')} — routed to human, no pricing/proposal`, 'Needs Clarification', 'Medium', true);
      return { status: 'needs_clarification' };
    }

    // Compute Pricing
    const gMin = Number(cfg.price_min) || 500;
    const gMax = Number(cfg.price_max) || 3000;
    const recurring = ctx.recurring;
    const recurringPrice = ctx.recurring_price;
    const complexity = String(r.complexity || 'unknown').toLowerCase();
    
    let price = 0; let price_tier = 'standard'; let needs_approval = false; const reasons = [];
    
    if (recurring) {
      price = recurringPrice;
      price_tier = 'recurring';
      if (recurringPrice <= 0) { needs_approval = true; reasons.push('recurring service has no configured recurring_price'); }
    } else if (ctx.cat_price_min <= 0 && ctx.cat_price_max <= 0) {
      needs_approval = true; reasons.push('service has no catalogue price range configured');
    } else {
      const mid = Math.round((ctx.cat_price_min + ctx.cat_price_max) / 2);
      if (complexity === 'low') { price = ctx.cat_price_min; price_tier = 'low'; }
      else if (complexity === 'high') { price = ctx.cat_price_max; price_tier = 'high'; }
      else if (complexity === 'medium') { price = mid; price_tier = 'medium'; }
      else { price = mid; price_tier = 'medium'; needs_approval = true; reasons.push('complexity unknown — price estimated at range midpoint, needs human confirmation'); }
    }

    if (!recurring) {
      if (price < gMin) { needs_approval = true; reasons.push(`price ${price} below configured minimum ${gMin}`); }
      if (price > gMax) { needs_approval = true; reasons.push(`price ${price} above configured maximum ${gMax}`); }
    }

    const upfront_amount = Math.round(price * 0.5 * 100) / 100;
    const final_amount = Math.round((price - upfront_amount) * 100) / 100;
    const payment_terms = `${cfg.payment_structure} (${cfg.currency} ${upfront_amount} upfront, ${cfg.currency} ${final_amount} on delivery)`;
    const approval_reason = reasons.join('; ') || 'within configured range';

    // Store Proposal
    const validity_date = new Date(Date.now() + 14 * 24 * 3600000);
    await Proposal.findOneAndUpdate({ proposal_id: ctx.proposal_id }, {
      proposal_id: ctx.proposal_id, opportunity_id: ctx.opportunity_id, lead_id: ctx.lead_id, requirement_id: ctx.requirement_id,
      scope: sa(r.scope), deliverables: sa(r.features), timeline: sa(r.timeline),
      price, price_tier, payment_terms, recurring_services: recurring ? ctx.service_name : '',
      approval_status: needs_approval ? 'pending' : 'auto_approved',
      acceptance_status: 'pending', status: needs_approval ? 'pending_approval' : 'draft',
      validity_date
    } as any, { upsert: true });

    if (needs_approval) {
      await Approval.findOneAndUpdate({ approval_id: `APR-${ctx.proposal_id}` }, {
        approval_id: `APR-${ctx.proposal_id}`, entity_type: 'proposal', entity_id: ctx.proposal_id,
        opportunity_id: ctx.opportunity_id, requested_action: 'send_priced_proposal',
        reason: approval_reason,
        details: `Service ${ctx.service_name} | Price ${cfg.currency} ${price} (${price_tier}) | Terms ${payment_terms}`,
        status: 'pending'
      } as any, { upsert: true });

      await Opportunity.findOneAndUpdate({ opportunity_id }, {
        service: ctx.service_name, estimated_value: price, scope_status: 'Scoped', proposal_status: 'Pending Approval', stage: 'Proposal'
      } as any);

      const msg = `A proposal is scoped and priced but requires human approval before it is sent to the prospect. The prospect has NOT been emailed.\n\nProspect: ${ctx.contact_name} <${ctx.prospect_email}>\nOpportunity: ${ctx.opportunity_id}\nService: ${ctx.service_name}\nPrice: ${cfg.currency} ${price} (${price_tier})\nTerms: ${payment_terms}\n\nWhy approval is required: ${approval_reason}\n\nScope: ${sa(r.scope)}\nDeliverables: ${sa(r.features)}\nTimeline: ${sa(r.timeline)}\n\nApproval record: APR-${ctx.proposal_id} (set status to approved/rejected in vynora_approvals).`;
      await mailerService.sendEmail(cfg.approval_email, `[VYNORA] Proposal needs approval — ${ctx.company_name} (${cfg.currency} ${price})`, msg);
      
      await this.logEvent(ctx.proposal_id, `Proposal priced ${cfg.currency} ${price} — held for human approval: ${approval_reason}; prospect NOT emailed`, 'Pending Approval', 'Medium', true);
      return { status: 'pending_approval' };
    }

    // Build Proposal Email
    const NL = '\n';
    const emailSys = `You are the founder of VYNORA writing a client proposal email. Use ONLY the facts provided below. Never invent requirements, deliverables, metrics, case studies, client names, timelines or capabilities beyond what is given. Do not change the price or payment terms. End the body with exactly this sign-off and nothing else:${NL}Vinay Kumar Makvana${NL}Founder, VYNORA${NL}Direct Contact: ${process.env.CONTACT_EMAIL}`;
    const emailLines = [
      'Write a concise, honest, persuasive proposal email. Return ONLY JSON: {"subject":"...","body_html":"..."} where body_html is a valid HTML email body.',
      `Prospect: ${ctx.contact_name || 'there'}`, `Company: ${ctx.company_name}`, `Service: ${ctx.service_name}`,
      `Business problem: ${sa(r.business_problem)}`, `Desired solution: ${sa(r.desired_solution)}`,
      `Scope: ${sa(r.scope)}`, `Deliverables/features: ${sa(r.features)}`,
      `Integrations: ${sa(r.integrations)}`, `Platform: ${sa(r.platform)}`, `Technology: ${sa(r.technology)}`,
      `Users: ${sa(r.users)}`, `Timeline: ${sa(r.timeline) || 'to be confirmed'}`,
      `Investment: ${cfg.currency} ${price} total. Payment terms: ${payment_terms}. Accepted payment methods: Binance (Preferred) and PayPal.`,
      'Structure: restate their problem, present the solution, list the concrete deliverables provided above (do not add new ones), state the investment, payment terms, and accepted payment methods exactly as given, and end with a clear call to action to approve and kick off. Keep it under 300 words.'
    ];

    const draftRes = await aiGatewayService.processAiRequest({ prompt: emailLines.join(NL), system_prompt: emailSys, temperature: 0.4, max_tokens: 1500 });
    
    let subject = ''; let body_html = '';
    if (draftRes.success) {
      try {
        let text = String(draftRes.text).trim();
        const start = text.indexOf('{'); const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) text = text.slice(start, end + 1);
        const j = JSON.parse(text);
        subject = j.subject || ''; body_html = j.body_html || '';
      } catch (e) { }
    }

    if (!draftRes.success || !subject || !body_html) {
      await Opportunity.findOneAndUpdate({ opportunity_id }, { service: ctx.service_name, estimated_value: price, scope_status: 'Scoped', proposal_status: 'Draft Deferred', stage: 'Proposal' } as any);
      await this.logEvent(ctx.opportunity_id, 'Proposal scoped and priced, stored as draft, but AI draft unavailable — not sent', 'Draft Deferred', 'Medium', false, draftRes.error || 'AI unavailable');
      return { status: 'draft_deferred' };
    }

    // Send Proposal Email
    const sendResult = await mailerService.sendEmail(ctx.prospect_email, subject, '', body_html);
    const idempotency = `PROP-OUT-${ctx.opportunity_id}`;

    if (sendResult.success) {
      await Message.create({
        message_id: `MSG-${ctx.proposal_id}`, conversation_id: ctx.conversation_id, lead_id: ctx.lead_id, contact_id: ctx.contact_id, opportunity_id: ctx.opportunity_id,
        channel: 'email', direction: 'outbound', purpose: 'proposal', subject, body: body_html, status: 'sent',
        provider_message_id: sendResult.messageId, sequence_step: 0, idempotency_key: idempotency, sent_at: new Date()
      } as any);
      await Proposal.findOneAndUpdate({ proposal_id: ctx.proposal_id }, { status: 'sent', approval_status: 'auto_approved' } as any);
      await Opportunity.findOneAndUpdate({ opportunity_id }, { service: ctx.service_name, estimated_value: price, stage: 'Proposal Sent', proposal_status: 'Sent', scope_status: 'Scoped' } as any);
      await Conversation.findOneAndUpdate({ conversation_id: ctx.conversation_id }, { conversation_id: ctx.conversation_id, lead_id: ctx.lead_id, contact_id: ctx.contact_id, opportunity_id: ctx.opportunity_id, channel: 'email', stage: 'proposal', next_best_action: 'Await proposal decision', status: 'open', last_message_at: new Date() } as any, { upsert: true });
      await this.logEvent(ctx.opportunity_id, `Proposal ${ctx.proposal_id} emailed to ${ctx.prospect_email} (${ctx.service_name}, ${cfg.currency} ${price}); within configured range — no invoice fired`, 'Proposal Sent', 'Low', false);
      return { status: 'sent', proposal_id: ctx.proposal_id };
    } else {
      await Message.create({
        message_id: `MSG-${ctx.proposal_id}-failed`, conversation_id: ctx.conversation_id, lead_id: ctx.lead_id, contact_id: ctx.contact_id, opportunity_id: ctx.opportunity_id,
        channel: 'email', direction: 'outbound', purpose: 'proposal', subject, body: body_html, status: 'failed',
        sequence_step: 0, idempotency_key: idempotency, error: 'Gmail send failed'
      } as any);
      await Proposal.findOneAndUpdate({ proposal_id: ctx.proposal_id }, { status: 'send_failed' } as any);
      await this.logEvent(ctx.opportunity_id, 'Proposal email send failed — proposal NOT marked sent; will retry', 'Send Failed', 'High', false, sendResult.error);
      return { status: 'send_failed', error: sendResult.error };
    }
  }
}
