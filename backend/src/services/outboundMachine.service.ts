import axios from 'axios';
import nodemailer from 'nodemailer';
import { Config } from '../models/Config';
import { Lead } from '../models/Lead';
import { Company } from '../models/Company';
import { Contact } from '../models/Contact';
import { Message } from '../models/Message';
import { LeadScore } from '../models/LeadScore';
import { Research } from '../models/Research';
import { Log } from '../models/Log';
import { aiGatewayService } from './aiGateway.service';

export const outboundMachineService = {
  
  async runMachine(invokedBy: string = 'cron') {
    const execution_id = `exec-${Date.now()}`;
    const workflow = 'VYNORA-W01-Outbound-Lead-Machine';
    console.log(`[${new Date().toISOString()}] Starting Outbound Lead Machine (Invoked by: ${invokedBy})`);

    try {
      // 1. Load Config & Compute Budget
      const configs = await Config.find({ is_active: true });
      const cfg: Record<string, string> = {};
      configs.forEach(c => cfg[c.config_key] = c.config_value);

      const num = (k: string, d: number) => { const v = Number(cfg[k]); return isNaN(v) ? d : v; };
      
      let waitDays = [3, 4, 5];
      try { 
        if (cfg.followup_wait_days) {
          waitDays = cfg.followup_wait_days.replace(/[|]/g, '').split(',').map(s => Number(s.trim())).filter(n => !isNaN(n)); 
        }
      } catch (e) {}
      if (!waitDays.length) waitDays = [3, 4, 5];

      const day_first_touch_cap = num('outbound_day_limit', num('day_first_touch_cap', 75));
      const shift_first_touch_cap = Math.ceil(day_first_touch_cap / 3); // Automatically split into 3 shifts

      const SHIFT_HOURS = 8;
      const now = new Date();
      const istNow = new Date(now.getTime() + (330 * 60000));
      const istShiftStartMs = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), Math.floor(istNow.getUTCHours() / SHIFT_HOURS) * SHIFT_HOURS, 0, 0, 0) - (330 * 60000);
      const istDayStartMs = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 0, 0, 0, 0) - (330 * 60000);

      // Only fetch messages sent TODAY (from day start onwards) to correctly compute the cap.
      // Fetching ALL messages would incorrectly count yesterday's quota against today!
      const todayStart = new Date(istDayStartMs);
      const sentMessages = await Message.find({
        direction: 'outbound',
        status: 'sent',
        sent_at: { $gte: todayStart }
      });
      let shift_first_touch_sent = 0;
      let day_first_touch_sent = 0;

      sentMessages.forEach(m => {
        const p = String(m.purpose || '').toLowerCase();
        const isFirstTouch = p === 'first_touch' || p === 'firsttouch' || p === 'first-touch' || p === '';
        const hasProviderId = m.provider_message_id && m.provider_message_id.trim() !== '';
        if (isFirstTouch && hasProviderId && m.sent_at) {
          const t = new Date(m.sent_at).getTime();
          if (t >= istShiftStartMs) shift_first_touch_sent++;
          if (t >= istDayStartMs) day_first_touch_sent++;
        }
      });

      console.log(`[Budget] Shift: ${shift_first_touch_sent}/${shift_first_touch_cap} | Day: ${day_first_touch_sent}/${day_first_touch_cap}`);

      const remaining_shift = Math.max(0, shift_first_touch_cap - shift_first_touch_sent);
      const remaining_day = Math.max(0, day_first_touch_cap - day_first_touch_sent);
      const remaining_budget = Math.min(remaining_shift, remaining_day);

      if (remaining_budget <= 0) {
        await Log.create({
          execution_id, workflow, entity_id: 'DAILY-CAP',
          action: `Daily/Shift outreach cap reached (${day_first_touch_sent}/${day_first_touch_cap} or ${shift_first_touch_sent}/${shift_first_touch_cap})`,
          result: 'Skipped', severity: 'Low', human_approval: false
        } as any);
        console.log('Budget cap reached. Exiting.');
        return { success: true, message: 'Budget cap reached' };
      }

      // 2. PRIORITY QUEUE: Fetch highest quality eligible leads
      // Eligible criteria: status='new' AND outreach_eligible=true
      const eligibleLeads = await Lead.find({ status: 'new', outreach_eligible: true });
      if (eligibleLeads.length === 0) {
        console.log('No new eligible leads found.');
        return { success: true, message: 'No new eligible leads found' };
      }

      // Fetch scores and sort
      const leadScores = await LeadScore.find({ lead_id: { $in: eligibleLeads.map(l => l.lead_id) } });
      const scoreMap = new Map(leadScores.map(s => [s.lead_id, s]));

      const priorityOrder: Record<string, number> = { 'High': 3, 'Medium': 2, 'Low': 1 };
      
      const sortedLeads = eligibleLeads.sort((a, b) => {
        const sA = scoreMap.get(a.lead_id);
        const sB = scoreMap.get(b.lead_id);
        const pA = sA ? priorityOrder[sA.priority] || 0 : 0;
        const pB = sB ? priorityOrder[sB.priority] || 0 : 0;
        if (pA !== pB) return pB - pA;
        return (sB?.total_score || 0) - (sA?.total_score || 0);
      });

      // Process exactly 1 lead per cycle to spread them out naturally (1 email every 5 minutes = human speed)
      const targetLeads = sortedLeads.slice(0, 1);
      
      // Minimum cap removed: send immediately to avoid stalling and user frustration

      // 3. Process Selected Leads
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      const transporter = nodemailer.createTransport({
        service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
      });
      try {
        for (const lead of targetLeads) {
          const company = await Company.findOne({ company_id: lead.company_id });
        const contact = await Contact.findOne({ contact_id: lead.contact_id });
        const research = await Research.findOne({ lead_id: lead.lead_id });
        const email = contact ? String(contact.email || '').toLowerCase().trim() : '';
        const out_key = `OUT-${email || 'none'}-firsttouch`;
        const emailMsgs = await Message.find({ idempotency_key: out_key });
        const companyLeads = await Lead.find({ company_id: lead.company_id });
        const domainCompanies = company ? await Company.find({ domain: company.domain }) : [];
        const contactMsgs = await Message.find({ contact_id: lead.contact_id, direction: 'outbound' });

        const companyValid = !!(company && company.name && company.domain);
        const hasRefs = !!(lead.company_id && lead.contact_id);
        const contactPresent = !!(contact && contact.contact_id && email.length > 0);
        const optOut = contact?.opt_out === true;

        const dupEmail = emailMsgs.length > 0;
        const dupContact = contactMsgs.length > 0;
        const dupCompany = companyLeads.some(j => j.lead_id !== lead.lead_id && ['contacted','send_failed','qualified_contacted','engaged','won'].includes(j.status));
        const dupDomain = domainCompanies.some(j => j.company_id !== lead.company_id);
        
        let decision = 'eligible'; let reason = 'Passed all gates';
        if (!hasRefs || !companyValid) { decision = 'invalid'; reason = 'Missing refs or invalid company'; }
        else if (!contactPresent) { decision = 'missing_contact'; reason = 'No contact/email'; }
        else if (optOut) { decision = 'not_qualified'; reason = 'Opted out'; }
        else if (dupEmail || dupContact || dupCompany || dupDomain) { decision = 'duplicate'; reason = 'Duplicate detected'; }
        else if (contact?.email_status?.toLowerCase() !== 'verified') { decision = 'needs_contact'; reason = 'Email not verified (safety catch)'; }

        if (decision !== 'eligible') {
          // QUEUE SAFETY: Must end in a clear state, NOT silent idle.
          if (decision === 'not_qualified' || decision === 'duplicate') {
            lead.status = 'not_qualified'; lead.stage = 'disqualified'; lead.outreach_eligible = false;
          } else {
            lead.status = 'needs_contact'; lead.stage = 'enrichment'; lead.outreach_eligible = false;
          }
          lead.notes = `BLOCKED: ${reason}`;
          await lead.save();
          await Log.create({ execution_id, workflow, entity_id: lead.lead_id, action: `Blocked: ${reason}`, result: decision, error: reason, severity: 'Low', human_approval: false });
          continue;
        }

        // OUTREACH HANDOFF CONTRACT
        const likely_pain_point = research?.likely_pain_point || 'outdated digital processes';
        const relevant_service = research?.relevant_service || 'website redesign and digital automation';
        const evidence = research?.evidence || 'general digital improvement opportunity identified';
        const companyCity = company?.country || 'your area';
        const companyIndustry = company?.industry || 'your industry';
        
        const system_prompt = `You are an expert B2B outreach writer for Vynora, a UK-based digital agency. 
Your job is to write a highly personalised, professional cold email that feels like it was written by a real human consultant — not a bot or a mass mailer.

Strict rules:
- Never use generic phrases like "I hope this email finds you well", "touching base", "circle back", or "synergies"
- Never make up fake statistics. Only use the evidence provided.
- The email must feel like YOU personally reviewed their website and noticed something specific
- DO NOT start with "I" — start with the company name or an observation
- Write in a warm, professional British English tone
- Return ONLY a valid JSON object with keys "subject" and "body". No markdown. No code blocks.`;

        const prompt = `Write a cold outreach email using the following details.

Company: ${company?.name}
Industry / Category: ${companyIndustry}
City / Area: ${companyCity}
Website: ${company?.website || company?.domain}
Identified Pain Point: ${likely_pain_point}
Relevant Vynora Service: ${relevant_service}
Evidence from their website: ${evidence}

The email must follow this EXACT structure:

1. SUBJECT LINE: Specific and curiosity-driven. Reference their company or pain point. Not clickbait. Max 10 words.

2. OPENING (2-3 sentences): Start with a genuine compliment or observation about what ${company?.name} does well. Then smoothly transition to the specific gap or pain point you noticed on their website or in their industry.

3. PAIN POINT SECTION (3-4 sentences): Describe the pain point clearly — explain WHY it is costing them clients or money. Use the evidence provided. Make it feel real and specific to THEM, not generic.

4. SOLUTION SECTION (3-4 bullet points with emojis): Show exactly how Vynora solves this:
   - One bullet per benefit
   - Each bullet starts with a relevant emoji
   - Focus on outcomes (more enquiries, saved time, higher conversion) not features

5. SOCIAL PROOF (2 sentences): Mention a result we achieved for a similar ${companyIndustry} business. You can say "a similar business in the UK" — do not make up a specific company name.

6. CTA (2-3 sentences): Offer a FREE 15-minute website audit. Make it low-pressure. Ask for a reply or a quick call.

7. SIGNATURE (exact format, do not change):
Warm regards,
Vinay
Founder, Vynora Digital Agency
🌐 Visit us: https://vynorapvt-one.vercel.app

P.S. — If you're already working with someone on your digital presence, no worries at all. But if results aren't where you'd like them to be, I'm happy to offer a free second opinion.

Return ONLY a JSON object: {"subject": "...", "body": "..."}`;

        const aiResult = await aiGatewayService.processAiRequest({ prompt, system_prompt, temperature: 0.75, max_tokens: 700 });
        await delay(4500); // 4.5 seconds delay to perfectly respect Gemini's strict 15 RPM free-tier limit
        
        if (aiResult.success) {
          let subject = ''; let body = '';
          try {
            let text = aiResult.text.trim();
            const start = text.indexOf('{'); const end = text.lastIndexOf('}');
            if (start !== -1 && end !== -1 && end > start) text = text.slice(start, end + 1);
            const p = JSON.parse(text);
            subject = p.subject || 'Quick idea';
            body = p.body || p.text || '';
          } catch (e) {
            subject = `Idea for ${company?.name}`;
            body = aiResult.text;
          }

          // Send Email
          let provider_id = '';
          let sendError = '';
          let status = 'failed';
          try {
            const info = await transporter.sendMail({ from: process.env.GMAIL_USER, to: email, subject, text: body });
            provider_id = info.messageId; // Requires real provider message ID
            status = 'sent';
          } catch (e: any) { sendError = e.message; }

          // Store Message
          await Message.create({
            message_id: `MSG-${lead.lead_id}-ft`, conversation_id: `CONV-${lead.lead_id}`, lead_id: lead.lead_id,
            contact_id: lead.contact_id, channel: 'email', direction: 'outbound', purpose: 'first_touch',
            subject, body, status, provider_message_id: provider_id, idempotency_key: out_key,
            sent_at: status === 'sent' ? new Date() : undefined, error: sendError
          });

          if (status === 'sent') {
            const next_followup_date = new Date(Date.now() + waitDays[0]*86400000);
            lead.status = 'contacted'; lead.stage = 'outreach'; lead.outreach_eligible = true;
            lead.last_contact_date = new Date(); lead.next_followup_date = next_followup_date;
            lead.notes = `SENT: First-touch dispatched. Priority: ${scoreMap.get(lead.lead_id)?.priority}`;
            await lead.save();
            await Log.create({ execution_id, workflow, entity_id: lead.lead_id, action: 'First-touch sent', result: 'Contacted', severity: 'Low', human_approval: false });
          } else {
            lead.status = 'send_failed'; lead.stage = 'outreach';
            lead.notes = `BLOCKED/FAILED: Send failed: ${sendError}`;
            await lead.save();
            await Log.create({ execution_id, workflow, entity_id: lead.lead_id, action: 'Send failed', result: 'Send Failed', error: sendError, severity: 'Medium', human_approval: false });
          }

        } else {
          // AI Failure -> DEFERRED state
          lead.status = 'new'; lead.stage = 'outreach_pending';
          lead.notes = `DEFERRED: AI unavailable: ${aiResult.error}`;
          await lead.save();
          await Log.create({ execution_id, workflow, entity_id: lead.lead_id, action: 'AI Deferred', result: 'Deferred', error: aiResult.error, severity: 'Medium', human_approval: false });
        }
        }
      } finally {
        transporter.close();
      }
      return { success: true, processed: targetLeads.length };
    } catch (error: any) {
      console.error('Error in runMachine:', error);
      return { success: false, error: error.message };
    }
  }
};
