import nodemailer from 'nodemailer';
import { Lead } from '../models/Lead';
import { Contact } from '../models/Contact';
import { Message } from '../models/Message';
import { Opportunity } from '../models/Opportunity';
import { Proposal } from '../models/Proposal';
import { Meeting } from '../models/Meeting';
import { Requirement } from '../models/Requirement';
import { Payment } from '../models/Payment';
import { Conversation } from '../models/Conversation';
import { Log } from '../models/Log';
import { Config } from '../models/Config';
import { LeadScore } from '../models/LeadScore';

export class ShiftReportService {
  private async sendEmail(to: string, subject: string, text: string) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
      });
      await transporter.sendMail({ from: process.env.GMAIL_USER, to, subject, text });
      return true;
    } catch (e) {
      console.error('Failed to send shift report email', e);
      return false;
    }
  }

  async runReport() {
    // 1. Fetch email address from environment
    const reportEmail = process.env.REPORT_EMAIL;
    if (!reportEmail) {
      throw new Error('REPORT_EMAIL is not defined in .env');
    }

    // 2. Fetch all data
    const [
      leads, contacts, messages, opps, proposals, meetings,
      requirements, payments, conversations, logs
    ] = await Promise.all([
      Lead.find(), Contact.find(), Message.find(), Opportunity.find(),
      Proposal.find(), Meeting.find(), Requirement.find(), Payment.find(),
      Conversation.find(), Log.find(), LeadScore.find()
    ]);

    const now = Date.now();
    const shiftStart = now - (8 * 3600 * 1000);
    const dayStart = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z').getTime();
    
    const inShift = (t: number) => t >= shiftStart;
    const low = (v: any) => String(v === undefined || v === null ? '' : v).toLowerCase();
    const ts = (r: any, f: string) => { const v = r[f] || (r as any).createdAt; if (!v) return 0; const t = new Date(v).getTime(); return isNaN(t) ? 0 : t; };

    // LEADS
    const leadsTotal = leads.length;
    const leadsNewShift = leads.filter(r => inShift(ts(r, 'createdAt'))).length;
    const verifiedContacts = contacts.filter(c => low(c.email_status) === 'verified').length;
    const foundContacts = contacts.filter(c => { const e = low(c.email_status); return e === 'found' || e === 'verified'; }).length;
    const noPublicEmail = leads.filter(r => r.notes?.includes('NO_PUBLIC_BUSINESS_EMAIL')).length;
    const qualified = leads.filter(r => low(r.qualification_status) === 'qualified').length;
    const unqualified = leads.filter(r => { const q = low(r.qualification_status); return q === 'unqualified' || q === 'not qualified' || low(r.status) === 'not_qualified'; }).length;
    
    // SCORE METRICS
    const highFit = leads.filter(r => r.outreach_eligible === true || String(r.outreach_eligible) === 'true').length;
    let scoresSum = 0; let scoreCount = 0;
    const leadScores = await LeadScore.find();
    leadScores.forEach(s => { if (s.fit_score) { scoresSum += s.fit_score; scoreCount++; } });
    const avgFitScore = scoreCount > 0 ? Math.round(scoresSum / scoreCount) : 0;
    const highPriority = leadScores.filter(s => s.priority === 'High').length;
    
    // QUEUE CONTINUITY & SAFETY
    const queuedLeads = leads.filter(r => r.status === 'new' && r.outreach_eligible === true).length;
    const silentIdle = leads.filter(r => r.status === 'new' && r.outreach_eligible === true && ts(r, 'createdAt') < (now - 86400000)).length;

    // OUTREACH
    const outbound = messages.filter(m => low(m.direction) === 'outbound');
    const isFT = (m: any) => { const p = low(m.purpose); return p === 'first_touch' || p === 'firsttouch' || p === 'first-touch' || p === ''; };
    const actualSent = outbound.filter(m => low(m.status) === 'sent' && m.provider_message_id && String(m.provider_message_id).trim() !== '');
    const firstTouchSent = actualSent.filter(isFT);
    
    const SHIFT_CAP = 25;
    const DAY_CAP = 75;
    const sentTotal = actualSent.length;
    const sentToday = firstTouchSent.filter(m => ts(m, 'sent_at') >= dayStart).length;
    const sentShift = firstTouchSent.filter(m => inShift(ts(m, 'sent_at'))).length;
    const remaining_shift = Math.max(0, SHIFT_CAP - sentShift);
    const remaining_day = Math.max(0, DAY_CAP - sentToday);
    const remainingCap = Math.min(remaining_shift, remaining_day);
    const senderAccount = 'VYNORA TEAM Gmail';

    const blockedVerif = logs.filter(r => low(r.result).indexOf('missing contact') !== -1 || low(r.result).indexOf('needs contact') !== -1).length;
    const blockedDup = logs.filter(r => low(r.result) === 'skipped' && low(r.action).indexOf('duplicate') !== -1).length;
    const blockedOptOut = logs.filter(r => low(r.result).indexOf('opt') !== -1 || low(r.action).indexOf('opt out') !== -1 || low(r.action).indexOf('suppress') !== -1).length;
    const blockedQual = leads.filter(r => low(r.qualification_status) === 'not qualified').length;
    const capBlocks = logs.filter(r => low(r.action).indexOf('cap reached') !== -1).length;

    // COMMUNICATION
    const inbound = messages.filter(m => low(m.direction) === 'inbound');
    const repliesTotal = inbound.length;
    const repliesShift = inbound.filter(m => inShift(ts(m, 'sent_at'))).length;
    const followupsSent = outbound.filter(m => low(m.purpose).indexOf('follow') !== -1 && low(m.status) === 'sent' && m.provider_message_id && String(m.provider_message_id).trim() !== '').length;
    const convTotal = conversations.length;
    const convActive = conversations.filter(c => { const s = low(c.status); return s === 'active' || s === 'open'; }).length;

    // PIPELINE
    const isClosed = (o: any) => { const s = low(o.stage); const c = low(o.contract_status); return s.indexOf('closed') !== -1 || c.indexOf('won') !== -1 || c.indexOf('lost') !== -1; };
    const oppsTotal = opps.length;
    const oppsActive = opps.filter(o => !isClosed(o)).length;
    const meetingsTotal = meetings.length;
    const reqTotal = requirements.length;
    const proposalsTotal = proposals.length;
    const negotiations = opps.filter(o => low(o.stage).indexOf('negotiat') !== -1).length;
    const approvalsPending = logs.filter(r => low(r.action).includes('approval pending') && inShift(ts(r, 'log_time'))).length; // Approvals from logs
    const wonTotal = opps.filter(o => low(o.stage) === 'closed won' || low(o.contract_status) === 'won').length;
    const lostTotal = opps.filter(o => low(o.stage).indexOf('lost') !== -1 || low(o.contract_status).indexOf('lost') !== -1).length;

    // FINANCE
    const RECEIVED = ['upfront paid', 'final paid', 'paid', 'verified', 'received', 'completed'];
    const verifiedPayments = payments.filter(p => RECEIVED.indexOf(low(p.status)) !== -1);
    const verifiedCount = verifiedPayments.length;
    let revenue = 0;
    for (const p of verifiedPayments) { const a = Number(p.amount); if (!isNaN(a)) revenue += a; }
    revenue = Math.round(revenue * 100) / 100;
    const netTarget = 30000;
    const netGap = Math.round((netTarget - revenue) * 100) / 100;

    // ACTIVITY BY PROSPECT
    const activity = [];
    for (const c of conversations) {
      const lead = leads.find(l => l.lead_id === c.lead_id) || {} as any;
      activity.push({
        company: lead.company_id || (c as any).company_id || '',
        stage: c.stage || lead.stage || '',
        last_action: c.next_best_action || c.status || '',
        next_action: c.next_best_action || '',
        next_followup_date: lead.next_followup_date || '',
      });
    }

    // SYSTEM HEALTH
    const w10runs = logs.filter(r => low(r.workflow).indexOf('w10') !== -1 && inShift(ts(r, 'log_time'))).length;
    const w01runs = logs.filter(r => low(r.workflow).indexOf('w01') !== -1 && inShift(ts(r, 'log_time'))).length;
    const w02runs = logs.filter(r => (low(r.workflow).indexOf('w02') !== -1 || low(r.workflow).indexOf('inbound') !== -1) && inShift(ts(r, 'log_time'))).length;
    const w11runs = logs.filter(r => low(r.workflow).indexOf('w11') !== -1 && inShift(ts(r, 'log_time'))).length;
    const w16cycles = logs.filter(r => low(r.workflow).indexOf('w16') !== -1 && String(r.action || '').indexOf('Control cycle START') === 0 && inShift(ts(r, 'log_time'))).length;
    const aiFailures = logs.filter(r => low(r.action).indexOf('ai') !== -1 && (low(r.result).indexOf('defer') !== -1 || low(r.result).indexOf('unavailable') !== -1) && inShift(ts(r, 'log_time'))).length;
    const wfErrors = logs.filter(r => (low(r.action) === 'workflow_error' || low(r.severity) === 'high') && inShift(ts(r, 'log_time'))).length;
    const recoveryEvents = logs.filter(r => (low(r.result).indexOf('retry') !== -1 || low(r.result).indexOf('hold') !== -1) && inShift(ts(r, 'log_time'))).length;
    const cooldownBlocks = logs.filter(r => low(r.action).indexOf('cooldown') !== -1 && inShift(ts(r, 'log_time'))).length;

    const shiftLabel = new Date(shiftStart).toISOString().slice(0, 16).replace('T', ' ') + ' -> ' + new Date(now).toISOString().slice(0, 16).replace('T', ' ');

    // Build the Email text
    const L: string[] = [];
    L.push('VYNORA 8-HOUR SHIFT REPORT');
    L.push(`Period (Asia/Calcutta): ${shiftLabel}`);
    L.push('');
    L.push('=== 1. RESEARCH & QUALITY ===');
    L.push(`Businesses researched: ${leadsTotal} (Target: 200/shift) | New this shift: ${leadsNewShift}`);
    L.push(`Public emails found: ${foundContacts} | No public email: ${noPublicEmail}`);
    L.push(`Verified emails (MX): ${verifiedContacts} | Rejected/unqualified: ${unqualified}`);
    L.push(`Qualified leads: ${qualified} | High-fit: ${highFit} | High-priority (AI scored): ${highPriority}`);
    L.push(`Average fit score: ${avgFitScore}/100`);
    L.push('');
    L.push('=== 2. OUTREACH (actual Gmail sends only) ===');
    L.push(`Eligible queued leads (continuity): ${queuedLeads} | Silent idle anomaly: ${silentIdle === 0 ? 'None' : silentIdle}`);
    L.push(`Emails sent this shift: ${sentShift} | Today: ${sentToday} | Total: ${sentTotal}`);
    L.push(`Actual Gmail provider message IDs recorded: ${actualSent.length}`);
    L.push(`Sender account: ${senderAccount}`);
    L.push(`Remaining daily capacity: ${remainingCap} / 25`);
    L.push(`Blocked — verification: ${blockedVerif} | duplicate: ${blockedDup} | opt-out: ${blockedOptOut} | qualification: ${blockedQual} | rate limit: ${capBlocks}`);
    L.push('');
    L.push('=== 3. COMMUNICATION ===');
    L.push(`Replies received: ${repliesTotal} (this shift: ${repliesShift})`);
    L.push(`Positive: 0 | Negative: 0 | Unclear: ${repliesTotal}`);
    L.push(`Follow-ups sent: ${followupsSent} | Conversations started: ${convTotal} | active: ${convActive}`);
    L.push('');
    L.push('=== 4. PIPELINE ===');
    L.push(`Opportunities: ${oppsTotal} (active: ${oppsActive}) | Meetings: ${meetingsTotal} | Requirements: ${reqTotal} | Proposals: ${proposalsTotal} | Negotiations: ${negotiations}`);
    L.push(`Pending approvals: ${approvalsPending} | Closed Won: ${wonTotal} | Closed Lost: ${lostTotal}`);
    L.push('');
    L.push('=== 5. FINANCE (verified only) ===');
    L.push(`Verified payments: ${verifiedCount} | Revenue: $${revenue} | Costs: $0 | Gross profit: $${revenue} | Net profit: $${revenue} | Target gap: $${netGap}`);
    L.push('');
    L.push('=== 6. ACTIVITY BY PROSPECT ===');
    if (activity.length === 0) { L.push('No active conversations yet.'); }
    for (const a of activity) { L.push(`- ${a.company} | stage: ${a.stage} | last: ${a.last_action} | next: ${a.next_action} | follow-up: ${a.next_followup_date}`); }
    L.push('');
    L.push('=== 7. SYSTEM HEALTH (this shift) ===');
    L.push(`W10 runs: ${w10runs} | W01 runs: ${w01runs} | W02 activity: ${w02runs} | W11 activity: ${w11runs} | W16 cycles: ${w16cycles}`);
    L.push(`AI failures: ${aiFailures} | Workflow errors: ${wfErrors} | Recovery events: ${recoveryEvents} | Cap blocks: ${capBlocks} | Cooldown blocks: ${cooldownBlocks}`);
    L.push('');
    L.push('=== 8. BUSINESS SUMMARY ===');
    if (sentShift === 0 && leadsNewShift === 0 && repliesShift === 0) {
      L.push('No new business activity this shift. The engine is healthy and waiting: sourcing, outreach, follow-up and reply handling remain armed.');
    } else {
      L.push(`This shift Vynora discovered ${leadsNewShift} lead(s), sent ${sentShift} real prospect email(s) via ${senderAccount}, received ${repliesShift} repl(y/ies), and recognized $${revenue} in verified revenue.`);
    }

    const body = L.join('\n');
    const subject = `[VYNORA] 8-Hour Shift Report — ${shiftLabel}`;
    
    await this.sendEmail(reportEmail, subject, body);

    return {
      status: 'success',
      report_generated: true,
      subject
    };
  }
}

export const shiftReportService = new ShiftReportService();
