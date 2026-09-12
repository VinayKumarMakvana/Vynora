import { Config } from '../models/Config';
import { Lead } from '../models/Lead';
import { Contact } from '../models/Contact';
import { Company } from '../models/Company';
import { Message } from '../models/Message';
import { Log } from '../models/Log';
import { Followup } from '../models/Followup';
import { aiGatewayService } from './aiGateway.service';
import nodemailer from 'nodemailer';

export class FollowupEngineService {
  private async getConfig() {
    const configs = await Config.find({ is_active: true });
    const cfg: Record<string, string> = {};
    configs.forEach(c => cfg[c.config_key] = c.config_value);
    return cfg;
  }

  private async logEvent(execution_id: string, entity_id: string, action: string, result: string, severity: string, error?: string) {
    await Log.create({
      execution_id, workflow: 'VYNORA-W11-Followup-Engine', entity_id, action, result, severity, error, human_approval: false, log_time: new Date()
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

  async runFollowups(sourceId?: string) {
    const execution_id = sourceId || `exec-fup-${Date.now()}`;
    const cfg = await this.getConfig();

    const dailyCapRaw = Number(cfg.daily_outreach_cap);
    const maxSteps = Number(cfg.followup_max_steps) || 3;
    let waitDays = [3, 4, 5];
    try {
      const raw = String(cfg.followup_wait_days || '3,4,5');
      waitDays = raw.replace(/[\[\]]/g, '').split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    } catch (e) {}
    if (!waitDays.length) waitDays = [3, 4, 5];
    const bdm_owner = cfg.bdm_owner_default || 'Vynora BDM';
    const todayStart = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');

    const PROVIDER_SAFE_DAY_CAP = 200;
    const sentTodayCount = await Message.countDocuments({
      direction: 'outbound',
      status: 'sent',
      sent_at: { $gte: todayStart }
    });

    if (sentTodayCount >= PROVIDER_SAFE_DAY_CAP) {
      await this.logEvent(execution_id, 'DAILY-CAP', `Daily cap reached (${sentTodayCount}/${PROVIDER_SAFE_DAY_CAP}) — no follow-ups this run`, 'Skipped', 'Low');
      return { status: 'success', message: 'Cap reached' };
    }

    const contactedLeads = await Lead.find({ status: 'contacted' });

    let processedCount = 0;
    let currentSent = sentTodayCount;

    for (const lead of contactedLeads) {
      if (currentSent >= PROVIDER_SAFE_DAY_CAP) {
        await this.logEvent(execution_id, lead.lead_id, `Daily cap reached mid-run — Cap reached ${currentSent}/${PROVIDER_SAFE_DAY_CAP} (left for next run)`, 'Skipped', 'Low');
        continue;
      }

      const contact = await Contact.findOne({ contact_id: lead.contact_id });
      const company = await Company.findOne({ company_id: lead.company_id });
      
      const inboundMsgs = await Message.find({ lead_id: lead.lead_id, direction: 'inbound' });
      const followupMsgs = await Message.find({ contact_id: lead.contact_id, direction: 'outbound' });
      
      const email = String(contact?.email || '').toLowerCase().trim();
      const emailStatus = String(contact?.email_status || '').toLowerCase().trim();
      const hasEmail = email.includes('@');
      const emailUsable = hasEmail && emailStatus !== 'invalid' && emailStatus !== 'bounced';
      const optOut = contact?.opt_out === true;
      const replied = inboundMsgs.length > 0;

      const sentFollowups = followupMsgs.filter(m => m.purpose === 'followup' && m.status === 'sent').length;
      const nextStep = sentFollowups + 1;
      const out_key = `FUP-${email || 'none'}-${nextStep}`;
      const alreadyThisStep = followupMsgs.some(m => m.idempotency_key === out_key);

      const now = Date.now();
      const nfd = lead.next_followup_date ? new Date(lead.next_followup_date).getTime() : 0;
      const due = nfd > 0 ? (nfd <= now) : true;

      let decision = 'eligible';
      let reason = `Due follow-up, step ${nextStep}`;

      if (optOut) { decision = 'opted_out'; reason = 'Contact opted out — suppressed'; }
      else if (replied) { decision = 'replied'; reason = 'Prospect replied — stop follow-up'; }
      else if (!emailUsable) { decision = 'missing_email'; reason = hasEmail ? `Email not usable (status=${emailStatus || 'unknown'})` : 'No contact email on file'; }
      else if (sentFollowups >= maxSteps) { decision = 'max_reached'; reason = `Reached max follow-ups (${maxSteps}) — move to nurture`; }
      else if (!due) { decision = 'not_due'; reason = 'Next follow-up not due yet'; }
      else if (alreadyThisStep) { decision = 'not_due'; reason = `Follow-up step ${nextStep} already sent this cycle`; }
      else if (currentSent >= PROVIDER_SAFE_DAY_CAP) { decision = 'cap_reached'; reason = `Daily cap reached ${currentSent}/${PROVIDER_SAFE_DAY_CAP}`; }

      const isLast = nextStep >= maxSteps;
      const waitIdx = Math.min(nextStep, waitDays.length - 1);
      const advanced_next_followup_date = new Date(now + (waitDays[waitIdx] || 3) * 86400000);
      const post_send_status = isLast ? 'nurture' : 'contacted';
      const post_send_eligible = !isLast;

      if (decision === 'eligible') {
        const promptLines = [
          `Write a short, polite FOLLOW-UP email (this is follow-up number ${nextStep} after an initial outreach they have not replied to). Return ONLY JSON with keys subject and body. Body about 90-140 words. Reference the earlier outreach naturally, add ONE fresh useful angle or piece of value relevant to their business (do not repeat the same pitch), and one soft low-friction CTA. Not pushy. Do not mention this is an automated sequence.`,
          `Prospect: ${contact?.name || 'there'}`,
          `Title: ${contact?.title || ''}`,
          `Company: ${company?.name || ''}`,
          `Industry: ${company?.industry || ''}`
        ].filter(Boolean).join('\n');

        const system_prompt = `You are a consultative B2B writer for VYNORA, a digital development and automation company helping businesses improve websites, software, UX, mobile experiences and AI/workflow automation. Write like a real person. NEVER invent facts, metrics, case studies, client names, reviews or internal prospect data. If uncertain, phrase as observation/possibility, not fact. No fake urgency, no spam, no guaranteed ROI. Sign off exactly like this (never a placeholder):\nBest,\nVynora Team\n\nVinay Kumar Makvana\nFounder, VYNORA\nDirect Contact: ${process.env.CONTACT_EMAIL}`;

        const aiResponse = await aiGatewayService.processAiRequest({
          prompt: promptLines,
          system_prompt,
          temperature: 0.7,
          max_tokens: 400
        });

        const success = aiResponse.success;
        let subject = ''; let body = '';
        if (success) {
          let text = aiResponse.text;
          const first = text.indexOf('{'); const last = text.lastIndexOf('}');
          if (first !== -1 && last !== -1 && last > first) { text = text.slice(first, last + 1); }
          try {
            const p = JSON.parse(text);
            subject = p.subject || ''; body = p.body || '';
          } catch (e) {
            body = aiResponse.text.trim();
            subject = `Following up — ${company?.name || 'your team'}`;
          }
        }

        const ai_ready = success && !!body && !!subject;

        if (ai_ready) {
          const emailRes = await this.sendEmail(email, subject, body);
          if (emailRes.success) {
            await Message.create({
              message_id: `MSG-${lead.lead_id}-fup${nextStep}`,
              conversation_id: `CONV-${lead.lead_id}`, lead_id: lead.lead_id, contact_id: lead.contact_id, opportunity_id: lead.opportunity_id || '',
              channel: 'email', direction: 'outbound', purpose: 'followup', subject, body,
              status: 'sent', provider_message_id: emailRes.messageId, sequence_step: nextStep,
              idempotency_key: out_key, sent_at: new Date()
            } as any);

            await Lead.findOneAndUpdate({ lead_id: lead.lead_id }, {
              status: post_send_status, stage: 'followup', outreach_eligible: post_send_eligible,
              bdm_owner, last_contact_date: new Date(), next_followup_date: advanced_next_followup_date,
              notes: `Follow-up ${nextStep} sent. is_last=${isLast}`
            } as any);

            await Followup.findOneAndUpdate({ followup_id: `FUP-${lead.lead_id}` }, {
              followup_id: `FUP-${lead.lead_id}`, lead_id: lead.lead_id, contact_id: lead.contact_id, conversation_id: `CONV-${lead.lead_id}`,
              channel: 'email', sequence_step: nextStep, last_sent_at: new Date(), scheduled_at: advanced_next_followup_date,
              status: isLast ? 'exhausted' : 'scheduled', reason: post_send_status
            } as any, { upsert: true });

            await this.logEvent(execution_id, lead.lead_id, `Follow-up ${nextStep} email sent`, 'Followed Up', 'Low');
            currentSent++;
            processedCount++;
          } else {
            await Message.create({
              message_id: `MSG-${lead.lead_id}-fup${nextStep}-failed`,
              conversation_id: `CONV-${lead.lead_id}`, lead_id: lead.lead_id, contact_id: lead.contact_id,
              channel: 'email', direction: 'outbound', purpose: 'followup', subject, body,
              status: 'failed', sequence_step: nextStep, idempotency_key: `${out_key}-failed`, error: 'Gmail send failed'
            } as any);
            await this.logEvent(execution_id, lead.lead_id, 'Follow-up email send failed — step NOT advanced', 'Send Failed', 'Medium', 'Gmail send failed');
          }
        } else {
          await this.logEvent(execution_id, lead.lead_id, 'Follow-up deferred — AI unavailable (safe hold, no send, step NOT advanced)', 'Deferred', 'Medium', aiResponse.error);
        }
      } else {
        if (decision === 'replied') {
          await Lead.findOneAndUpdate({ lead_id: lead.lead_id }, { status: 'replied', outreach_eligible: false, notes: 'Prospect replied — follow-up sequence stopped (handled by W02).' } as any);
          await this.logEvent(execution_id, lead.lead_id, 'Follow-up skipped — prospect already replied', 'Replied', 'Low');
        } else if (decision === 'opted_out') {
          await Lead.findOneAndUpdate({ lead_id: lead.lead_id }, { status: 'suppressed', outreach_eligible: false, notes: 'Contact opted out — suppressed from follow-up.' } as any);
          await this.logEvent(execution_id, lead.lead_id, 'Follow-up skipped — contact opted out', 'Suppressed', 'Low');
        } else if (decision === 'not_due') {
          await this.logEvent(execution_id, lead.lead_id, `Follow-up not due — ${reason}`, 'Skipped', 'Low');
        } else if (decision === 'max_reached') {
          await Lead.findOneAndUpdate({ lead_id: lead.lead_id }, { status: 'nurture', stage: 'nurture', outreach_eligible: false, notes: reason } as any);
          await this.logEvent(execution_id, lead.lead_id, 'Max follow-ups reached — moved to nurture/stop', 'Nurture', 'Low');
        } else if (decision === 'missing_email') {
          await Lead.findOneAndUpdate({ lead_id: lead.lead_id }, { status: 'needs_contact', stage: 'enrichment', outreach_eligible: false, notes: reason } as any);
          await this.logEvent(execution_id, lead.lead_id, 'Follow-up skipped — no contact email', 'Missing Contact', 'Low', reason);
        } else {
          await this.logEvent(execution_id, lead.lead_id, `Unrouted decision: ${decision}`, 'Unrouted', 'Medium');
        }
      }
    }

    return { status: 'success', processedCount };
  }
}

export const followupEngineService = new FollowupEngineService();
