import { Config } from '../models/Config';
import { Lead } from '../models/Lead';
import { Opportunity } from '../models/Opportunity';
import { Contact } from '../models/Contact';
import { Company } from '../models/Company';
import { Conversation } from '../models/Conversation';
import { Meeting } from '../models/Meeting';
import { Log } from '../models/Log';
import { aiGatewayService } from './aiGateway.service';
import { mailerService } from './mailer.service';
import axios from 'axios';

export class MeetingService {

  private async getConfig() {
    const configs = await Config.find({ is_active: true });
    const cfg: Record<string, string> = {};
    configs.forEach(c => cfg[c.config_key] = c.config_value);

    const num = (k: string, d: number) => {
      const v = Number(cfg[k]);
      return isNaN(v) ? d : v;
    };

    return {
      approval_email: process.env.APPROVAL_EMAIL || cfg.approval_email,
      meeting_duration_default: num('meeting_duration_default', 30),
      meeting_reminder_hours: num('meeting_reminder_hours', 24),
      meeting_default_timezone: cfg.meeting_default_timezone || 'UNKNOWN',
      meeting_discovery_min_fields: num('meeting_discovery_min_fields', 3),
    };
  }

  private async logEvent(entity_id: string, action: string, result: string, severity: string, error?: string, human_approval: boolean = false) {
    await Log.create({
      execution_id: `exec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      workflow: 'VYNORA-W05-Meeting-Discovery-Engine',
      entity_id: entity_id || 'unknown',
      action,
      result,
      severity,
      error: error || undefined,
      human_approval,
      log_time: new Date()
    } as any);
  }

  async handleMeetingWebhook(body: any) {
    const cfg = await this.getConfig();
    const s = (v: any) => (v === undefined || v === null) ? '' : String(v).trim();
    
    let action = s(body.action).toLowerCase();
    const allowed = ['propose', 'confirm', 'cancel', 'reschedule', 'discovery'];
    if (!allowed.includes(action)) action = 'propose';

    const opportunity_id = s(body.opportunity_id);
    const lead_id = s(body.lead_id);
    const valid = opportunity_id.length > 0 || lead_id.length > 0;
    
    if (!valid) {
      await this.logEvent(opportunity_id || 'unknown', `Invalid meeting request rejected: Missing opportunity_id and lead_id`, 'Invalid', 'Medium');
      return { status: 'error', error: 'Missing opportunity_id and lead_id' };
    }

    const opp = await Opportunity.findOne({ opportunity_id }) || {} as any;
    const lead = await Lead.findOne({ lead_id: lead_id || opp.lead_id }) || {} as any;
    
    const resolvedOppId = opportunity_id || opp.opportunity_id || lead.opportunity_id || '';
    const resolvedLeadId = lead_id || lead.lead_id || opp.lead_id || '';
    
    const contact = await Contact.findOne({ contact_id: s(body.contact_id) || lead.contact_id }) || {} as any;
    const company = await Company.findOne({ company_id: s(body.company_id) || lead.company_id }) || {} as any;
    const conv = await Conversation.findOne({ opportunity_id: resolvedOppId }) || {} as any;
    
    const meeting_id = `MEET-${resolvedOppId || resolvedLeadId}`;
    const meeting = await Meeting.findOne({ meeting_id }) || {} as any;

    const existing_meeting = !!meeting.meeting_id;
    const prospect_email = s(contact.email);
    const has_email = prospect_email.includes('@');
    
    if (action === 'propose') {
      return this.handlePropose(body, cfg, resolvedOppId, resolvedLeadId, contact, company, conv, meeting_id, prospect_email, has_email, opp);
    } else if (action === 'confirm') {
      return this.handleConfirm(body, cfg, resolvedOppId, meeting_id, meeting, existing_meeting, contact, company);
    } else if (action === 'cancel') {
      return this.handleCancel(body, resolvedOppId, meeting_id, existing_meeting);
    } else if (action === 'reschedule') {
      return this.handleReschedule(body, resolvedOppId, meeting_id, existing_meeting);
    } else if (action === 'discovery') {
      return this.handleDiscovery(body, cfg, resolvedOppId, resolvedLeadId, contact, company, meeting_id, meeting, existing_meeting, conv);
    }
  }

  private async handlePropose(body: any, cfg: any, oppId: string, leadId: string, contact: any, company: any, conv: any, meeting_id: string, email: string, has_email: boolean, opp: any) {
    const s = (v: any) => (v === undefined || v === null) ? '' : String(v).trim();
    
    const context_ok = !!oppId || !!leadId;
    if (!context_ok) {
      const msg = `A meeting request could not be processed because the opportunity/lead was not found.\nOpportunity: ${oppId}\nLead: ${leadId}\nNo meeting was created.`;
      await mailerService.sendEmail(cfg.approval_email, `[VYNORA] Scheduling blocked — context not found (${oppId})`, msg);
      await this.logEvent(oppId, 'Scheduling request could not be processed — opportunity/lead not found', 'Missing Context', 'Medium', undefined, true);
      return { status: 'error', reason: 'missing_context', opportunity_id: oppId };
    }

    const intentText = [body.intent, conv.intent, conv.stage, conv.buying_signals, conv.next_best_action, body.notes].map(x => String(x || '').toLowerCase()).join(' ');
    const optOut = String(contact.opt_out).toLowerCase() === 'true';
    const oppStage = String(opp.stage || '').toLowerCase();
    const oppContract = String(opp.contract_status || '').toLowerCase();
    const closedLost = /closed.?lost|lost/.test(oppStage) || oppContract === 'lost';
    const closedWon = /closed.?won|won/.test(oppStage) || oppContract === 'won';
    const negative = /not interested|unsubscrib|opt.?out|no thanks|decline|spam|reject/.test(intentText);
    const explicitMeeting = /meeting|call|demo|discovery|schedul|book|discuss|available|talk/.test(intentText);
    const positive = /interest|want|meeting|call|demo|discovery|schedul|book|discuss|available|talk|keen|ready/.test(intentText);

    let interested = false; let block_reason = '';
    if (optOut) block_reason = 'contact_opt_out';
    else if (negative) block_reason = 'negative_intent';
    else if (closedLost) block_reason = 'closed_lost';
    else if (closedWon && !(explicitMeeting || String(body.allow_when_won).toLowerCase() === 'true')) block_reason = 'already_won_no_new_meeting';
    else if (positive) interested = true;
    else block_reason = 'unclear_intent';

    if (!interested) {
      await this.logEvent(oppId, `Meeting NOT scheduled — ${block_reason} (W02 owns intent; no genuine meeting interest)`, 'Not Scheduled', 'Low');
      return { status: 'not_scheduled', reason: block_reason, opportunity_id: oppId };
    }

    const nextSlots = () => {
      const out = []; let added = 0; let cursor = new Date(Date.now() + 24*3600000);
      while (added < 3) {
        const day = cursor.getUTCDay();
        if (day !== 0 && day !== 6) { 
          const label = cursor.toISOString().slice(0,10); 
          out.push(label + ' 10:00 UTC'); out.push(label + ' 15:00 UTC'); added++; 
        }
        cursor = new Date(cursor.getTime() + 24*3600000);
      }
      return out;
    };
    const slots = nextSlots();
    const slots_text = slots.join(' | ');

    const NL = '\n';
    const channel = s(body.channel) || 'video call';
    const duration = s(body.duration) || (cfg.meeting_duration_default + ' min');
    const contact_name = contact.name || 'there';
    const company_name = company.name || 'your team';
    
    const system_prompt = `You are a friendly B2B scheduler for VYNORA, a software & AI/automation studio. Rules: never invent facts, capabilities, prices, commitments, meeting links or availability beyond the slots provided. Keep it short, warm, professional. End the body with exactly this sign-off and nothing else:${NL}Vinay Kumar Makvana${NL}Founder, VYNORA${NL}Direct Contact: ${process.env.CONTACT_EMAIL}`;
    const prompt = `Write a SHORT email proposing a discovery ${channel}. Return ONLY JSON with keys subject and body. Offer these exact time-slot options (do not invent others) and ask the prospect to reply with the one that works, or suggest another: ${slots_text}.\nProspect: ${contact_name}\nCompany: ${company_name}\nIndustry: ${company.industry || ''}\n${conv.pain_point ? ('Known interest / pain point: ' + conv.pain_point) : ''}`;

    const aiRes = await aiGatewayService.processAiRequest({ prompt, system_prompt, temperature: 0.5, max_tokens: 400 });
    
    let subject = ''; let emailBody = ''; let used_ai = false;
    if (aiRes.success) {
      try {
        let text = aiRes.text;
        const f = text.indexOf('{'); const l = text.lastIndexOf('}');
        if (f !== -1 && l !== -1 && l > f) text = text.slice(f, l + 1);
        const p = JSON.parse(text);
        subject = p.subject; emailBody = p.body; used_ai = !!subject && !!emailBody;
      } catch (e) {}
    }

    if (!used_ai) {
      subject = `Quick discovery call for ${company_name}?`;
      emailBody = `Hi ${contact_name},${NL}${NL}Thanks for your interest. I would love to set up a short ${channel} to understand your goals and see how VYNORA can help.${NL}${NL}Would any of these work?${NL}  1) ${slots[0]}${NL}  2) ${slots[2]}${NL}  3) ${slots[4]}${NL}${NL}If none suit, just reply with a time that does.${NL}${NL}Vinay Kumar Makvana${NL}Founder, VYNORA${NL}Direct Contact: ${process.env.CONTACT_EMAIL}`;
    }

    let statusLabel = 'availability_pending';
    let notes = `Proposed slots: ${slots_text}`;
    let resStatus = ''; let resReason = '';

    if (has_email) {
      const emailRes = await mailerService.sendEmail(email, subject, emailBody);
      const sent = emailRes.success;
      if (sent) {
        resStatus = 'proposed';
        await this.logEvent(oppId, `Meeting proposal sent to prospect (used_ai=${used_ai})`, 'Proposed', 'Low');
      } else {
        notes = 'Proposal email send failed — not marked sent; safe to retry.';
        resStatus = 'error'; resReason = 'send_failed';
        await this.logEvent(oppId, 'Meeting proposal email send failed — not marked sent', 'Send Failed', 'Medium', 'Gmail send failed');
      }
    } else {
      const notifyMsg = `No prospect email on file — please reach out manually.\n\nProspect: ${contact_name}\nCompany: ${company_name}\nProposed slots: ${slots_text}\n\nDraft:\n${emailBody}`;
      await mailerService.sendEmail(cfg.approval_email, `[VYNORA] Manual scheduling needed — ${company_name} (${oppId})`, notifyMsg);
      notes = `No prospect email — routed to human. Proposed slots: ${slots_text}`;
      resStatus = 'human_scheduling'; resReason = 'no_prospect_email';
      await this.logEvent(oppId, 'Meeting scheduling routed to human — no prospect email', 'Human Route', 'Low', undefined, true);
    }

    await Meeting.findOneAndUpdate(
      { meeting_id },
      {
        meeting_id, opportunity_id: oppId, lead_id: leadId, contact_id: contact.contact_id, company_id: company.company_id,
        channel, duration, status: statusLabel, confirmation_sent: false, reminder_sent: false, source: 'w05', notes
      },
      { upsert: true, new: true }
    );

    const out: any = { status: resStatus, meeting_id };
    if (resReason) out.reason = resReason;
    if (resStatus === 'proposed') out.opportunity_id = oppId;
    return out;
  }

  private async handleConfirm(body: any, cfg: any, oppId: string, meeting_id: string, meeting: any, existing: boolean, contact: any, company: any) {
    if (!existing) {
      await this.logEvent(oppId, 'Confirm received for unknown/missing meeting — safe no-op, no fabrication', 'Confirm Unknown', 'Medium');
      return { status: 'error', reason: 'meeting_not_found', opportunity_id: oppId };
    }

    const s = (v: any) => (v === undefined || v === null) ? '' : String(v).trim();
    const bodyTz = s(body.timezone || body.tz);
    const sched = s(body.scheduled_at || body.confirmed_time || body.slot);
    const schedHasTz = /Z$|UTC|GMT|[+-]\\d{2}:?\\d{2}/.test(sched);
    const tz_resolved = bodyTz || (schedHasTz ? 'from_timestamp' : '') || (cfg.meeting_default_timezone !== 'UNKNOWN' ? cfg.meeting_default_timezone : '');
    const tz_ok = !!tz_resolved;
    const duration = s(body.duration) || (cfg.meeting_duration_default + ' min');
    const reminder_key = `REMINDER-${meeting_id}-${cfg.meeting_reminder_hours}h`;

    if (!tz_ok) {
      const notifyMsg = `A confirmation was requested but the timezone is ambiguous and materially affects scheduling. Please clarify with the prospect before confirming.\n\nProspect: ${contact.name || 'there'}\nCompany: ${company.name || ''}\nRequested time: ${sched}\nMeeting: ${meeting_id}`;
      await mailerService.sendEmail(cfg.approval_email, `[VYNORA] Ambiguous timezone — confirm scheduling (${oppId})`, notifyMsg);
      await Meeting.updateOne({ meeting_id }, { status: 'availability_pending', notes: `Confirm blocked — ambiguous timezone for ${sched}. Routed to human.` });
      await this.logEvent(meeting_id, 'Confirmation blocked — ambiguous timezone; routed to human (no silent assumption)', 'Ambiguous Timezone', 'Medium', undefined, true);
      return { status: 'needs_timezone', reason: 'ambiguous_timezone', meeting_id };
    }

    const subject = `Confirmed: your VYNORA discovery call — ${sched}`;
    const emailBody = `Hi ${contact.name || 'there'},\n\nYour discovery ${meeting.channel || 'call'} is confirmed.\n\nDate/time: ${sched}\nTimezone: ${tz_resolved}\nDuration: ${duration}\n\nLooking forward to speaking.\n\nVinay Kumar Makvana\nFounder, VYNORA\nDirect Contact: ${process.env.CONTACT_EMAIL}`;

    let sent = false; let notes = `Confirmed for ${sched} (${tz_resolved}). ${s(body.notes)}`;
    if (s(contact.email).includes('@')) {
      const emailRes = await mailerService.sendEmail(contact.email, subject, emailBody);
      sent = emailRes.success;
    }

    if (sent) {
      await Meeting.updateOne({ meeting_id }, { status: 'confirmed', scheduled_at: new Date(sched), timezone: tz_resolved, duration, reminder_key, reminder_sent: false, confirmation_sent: true, notes });
      await this.logEvent(meeting_id, `Meeting ${meeting_id} confirmed for ${sched} (${tz_resolved})`, 'Confirmed', 'Low');
      return { status: 'confirmed', meeting_id, scheduled_at: sched };
    } else {
      await Meeting.updateOne({ meeting_id }, { status: 'confirmed', scheduled_at: new Date(sched), timezone: tz_resolved, duration, reminder_key, reminder_sent: false, confirmation_sent: false, notes });
      await this.logEvent(meeting_id, 'Confirmation email failed — meeting stays confirmed, confirmation NOT marked sent', 'Confirm Send Failed', 'Medium', 'Gmail send failed', true);
      return { status: 'confirmed_no_email', reason: 'confirmation_send_failed', meeting_id };
    }
  }

  private async handleCancel(body: any, oppId: string, meeting_id: string, existing: boolean) {
    if (!existing) {
      await this.logEvent(oppId, 'Cancel received for unknown meeting — safe no-op', 'Cancel Unknown', 'Low');
      return { status: 'error', reason: 'meeting_not_found' };
    }
    const notes = `Cancelled. ${body.notes || ''}`;
    await Meeting.updateOne({ meeting_id }, { status: 'cancelled', reminder_sent: true, reminder_key: 'CANCELLED', notes });
    await this.logEvent(meeting_id, 'Meeting cancelled — reminder invalidated', 'Cancelled', 'Low');
    return { status: 'cancelled', meeting_id };
  }

  private async handleReschedule(body: any, oppId: string, meeting_id: string, existing: boolean) {
    if (!existing) {
      await this.logEvent(oppId, 'Reschedule received for unknown meeting — safe no-op', 'Reschedule Unknown', 'Low');
      return { status: 'error', reason: 'meeting_not_found' };
    }
    const notes = `Reschedule requested — old reminder invalidated. ${body.notes || ''}`;
    await Meeting.updateOne({ meeting_id }, { status: 'reschedule_requested', reminder_sent: false, reminder_key: 'RESCHEDULE-PENDING', notes });
    await this.logEvent(meeting_id, 'Meeting reschedule requested — old reminder invalidated', 'Reschedule Requested', 'Low');
    return { status: 'reschedule_requested', meeting_id };
  }

  private async handleDiscovery(body: any, cfg: any, oppId: string, leadId: string, contact: any, company: any, meeting_id: string, meeting: any, existing: boolean, conv: any) {
    if (meeting.discovery_status === 'handed_off') {
      await this.logEvent(meeting_id, 'Discovery already handed to W03 — duplicate handoff prevented', 'Duplicate Handoff', 'Low');
      return { status: 'already_handed_to_w03', meeting_id };
    }

    const s = (v: any) => (v === undefined || v === null) ? '' : String(v).trim();
    const raw = s(body.discovery_notes || body.notes || meeting.notes || '');

    const NL = '\n';
    const system_prompt = 'You extract structured B2B discovery information from meeting notes for VYNORA. Rules: NEVER invent facts. Only use what is explicitly present. For each field, classify as confirmed (clearly stated) or leave blank if not stated. Return ONLY JSON.';
    const prompt = `From the discovery notes below, return ONLY JSON with these string keys (empty string if not stated): business_problem, desired_solution, features, integrations, platform, technology, timeline, budget, users, scope, complexity, decision_maker, constraints, objections, next_action.\nAlso include arrays "assumptions" (things inferred, not stated) and "missing" (important fields not covered).\nDiscovery notes:\n${raw || '(no notes provided)'}`;

    const aiRes = await aiGatewayService.processAiRequest({ prompt, system_prompt, temperature: 0.2, max_tokens: 700 });
    
    let parsed: any = {}; let ai_ready = false;
    if (aiRes.success) {
      try {
        let text = aiRes.text;
        const f = text.indexOf('{'); const l = text.lastIndexOf('}');
        if (f !== -1 && l !== -1 && l > f) text = text.slice(f, l + 1);
        parsed = JSON.parse(text); ai_ready = true;
      } catch (e) { ai_ready = false; }
    }

    const fields = ['business_problem','desired_solution','features','integrations','platform','technology','timeline','budget','users','scope','complexity','decision_maker','constraints','objections','next_action'];
    const confirmed: any = {}; let count = 0;
    for (const f of fields) {
      const val = ai_ready ? String(parsed[f] || '').trim() : '';
      confirmed[f] = val; if (val) count++;
    }

    const assumptions = ai_ready && Array.isArray(parsed.assumptions) ? parsed.assumptions : [];
    const missing = ai_ready && Array.isArray(parsed.missing) ? parsed.missing : fields.filter(f => !confirmed[f]);
    const enough = ai_ready && count >= cfg.meeting_discovery_min_fields;

    if (!ai_ready) {
      const msg = `AI extraction was unavailable. Raw discovery notes preserved for manual structuring before W03 handoff.\n\nMeeting: ${meeting_id}\nError: ${aiRes.error || 'AI unavailable'}\n\nRaw notes:\n${raw}`;
      await mailerService.sendEmail(cfg.approval_email, `[VYNORA] Discovery extraction pending — ${company.name || 'Company'} (${meeting_id})`, msg);
      await Meeting.updateOne({ meeting_id }, { discovery_status: 'extraction_pending', notes: `Raw discovery preserved — AI extraction unavailable. Notes: ${raw}` });
      await this.logEvent(meeting_id, 'Discovery AI unavailable — raw preserved, routed to human, no fabrication', 'Discovery Pending', 'Medium', aiRes.error || 'AI unavailable', true);
      return { status: 'discovery_extraction_pending', meeting_id };
    }

    if (enough) {
      await Meeting.updateOne({ meeting_id }, { status: 'completed', discovery_status: 'handed_off', notes: `Discovery captured (${count} confirmed fields) and handed to W03.` });
      // Call W03 (vynora/meeting-scope)
      try {
        await axios.post('http://localhost:3000/api/vynora/meeting-scope', {
          opportunity_id: oppId, lead_id: leadId, contact_id: contact.contact_id, company_id: company.company_id,
          meeting_id, conversation_id: conv.conversation_id,
          confirmed: JSON.stringify(confirmed), assumptions: assumptions.join('; '), missing: missing.join('; '),
          next_action: confirmed.next_action || '', notes: raw, source: 'w05_discovery'
        });
      } catch (e: any) {
        console.error('W03 handoff failed', e.message);
      }
      await this.logEvent(meeting_id, `Discovery handed to W03 (${count} confirmed fields)`, 'Handed To W03', 'Low');
      return { status: 'discovery_handed_to_w03', meeting_id, confirmed_fields: count };
    } else {
      await Meeting.updateOne({ meeting_id }, { discovery_status: 'partial', notes: `Partial discovery (${count} fields) — awaiting more before W03. Missing: ${missing.join('; ')}` });
      await this.logEvent(meeting_id, 'Discovery incomplete — not handed to W03, no fabrication', 'Discovery Partial', 'Low');
      return { status: 'discovery_incomplete', meeting_id, confirmed_fields: count, missing: missing.join('; ') };
    }
  }

  async handleReminderSweep() {
    const cfg = await this.getConfig();
    const reminderHours = cfg.meeting_reminder_hours || 24;
    const now = Date.now();
    const windowMs = reminderHours * 3600000;

    const meetings = await Meeting.find({ status: { $in: ['confirmed', 'scheduled'] }, reminder_sent: false });

    for (const m of meetings) {
      const when = m.scheduled_at ? new Date(m.scheduled_at).getTime() : 0;
      if (!when || isNaN(when) || when <= now || (when - now > windowMs)) continue;

      const contact = await Contact.findOne({ contact_id: m.contact_id } as any) as any;
      const email = contact?.email || '';
      
      if (email.includes('@')) {
        const subject = `Reminder: your VYNORA discovery call — ${m.scheduled_at}`;
        const msg = `Hi ${contact?.name || 'there'},\n\nA quick reminder about our upcoming discovery ${m.channel || 'call'}.\n\nDate/time: ${m.scheduled_at}\nTimezone: ${m.timezone}\nDuration: ${m.duration}\n\nSee you then.\n\nVinay Kumar Makvana\nFounder, VYNORA\nDirect Contact: ${process.env.CONTACT_EMAIL}`;
        
        const emailRes = await mailerService.sendEmail(email, subject, msg);
        const sent = emailRes.success;
        if (sent) {
          m.reminder_sent = true;
          m.reminder_key = `REMINDER-${m.meeting_id}-${reminderHours}h`;
          await m.save();
          await this.logEvent(m.meeting_id, `Meeting reminder sent for ${m.scheduled_at}`, 'Reminder Sent', 'Low');
        } else {
          await this.logEvent(m.meeting_id, 'Reminder email failed — NOT marked sent, safe to retry next sweep', 'Reminder Failed', 'Medium', 'Gmail send failed');
        }
      }
    }
  }
}
