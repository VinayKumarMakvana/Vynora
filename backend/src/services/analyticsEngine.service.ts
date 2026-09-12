import nodemailer from 'nodemailer';
import { Config } from '../models/Config';
import { Payment } from '../models/Payment';
import { Opportunity } from '../models/Opportunity';
import { Lead } from '../models/Lead';
import { Analytics } from '../models/Analytics';
import { Log } from '../models/Log';

export class AnalyticsEngineService {
  private async getConfig() {
    const configs = await Config.find({ is_active: true });
    const cfg: Record<string, string> = {};
    configs.forEach(c => cfg[c.config_key] = c.config_value);
    
    const num = (k: string, d: number) => { const v = Number(cfg[k]); return isNaN(v) ? d : v; };
    const str = (k: string, d: string) => { const v = cfg[k]; return v === undefined || v === null || v === '' ? d : String(v); };
    
    return {
      revenue_target_monthly: num('revenue_target_monthly', 30000),
      price_min: num('price_min', 500),
      price_max: num('price_max', 3000),
      conversion_opp_to_won: num('conversion_opp_to_won', 0.25),
      conversion_lead_to_opp: num('conversion_lead_to_opp', 0.30),
      conversion_outreach_reply: num('conversion_outreach_reply', 0.15),
      conversion_conversation_opp: num('conversion_conversation_opp', 0.40),
      net_profit_target_monthly: num('net_profit_target_monthly', 30000),
      cost_fixed_monthly: num('cost_fixed_monthly', 0),
      cost_variable_percent: num('cost_variable_percent', 0),
      approval_email: process.env.APPROVAL_EMAIL || str('approval_email', '')
    };
  }

  private async sendEmail(to: string, subject: string, text: string) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
      });
      await transporter.sendMail({ from: process.env.GMAIL_USER, to, subject, text });
      return true;
    } catch (e) {
      console.error('Failed to send analytics email', e);
      return false;
    }
  }

  async runAnalytics() {
    const cfg = await this.getConfig();
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const period = `${y}-${String(m + 1).padStart(2, '0')}`;
    const monthStart = Date.UTC(y, m, 1);
    const monthEnd = Date.UTC(y, m + 1, 1);

    const payments = await Payment.find();
    let closedRevenue = 0;
    let receivedCount = 0;
    const RECEIVED = ['upfront paid', 'final paid', 'paid', 'verified', 'received', 'completed'];

    for (const p of payments) {
      const st = (p.status || '').toLowerCase().trim();
      if (!RECEIVED.includes(st)) continue;
      
      const t = new Date((p as any).createdAt).getTime();
      if (t >= monthStart && t < monthEnd) {
        const amt = Number(p.amount);
        if (!isNaN(amt) && amt > 0) {
          closedRevenue += amt;
          receivedCount++;
        }
      }
    }
    closedRevenue = Math.round(closedRevenue * 100) / 100;

    const costsUnset = cfg.cost_fixed_monthly === 0 && cfg.cost_variable_percent === 0;
    const costVariable = Math.round((closedRevenue * (cfg.cost_variable_percent / 100)) * 100) / 100;
    const costTotal = Math.round((cfg.cost_fixed_monthly + costVariable) * 100) / 100;
    const grossProfit = Math.round((closedRevenue - costVariable) * 100) / 100;
    const grossMargin = closedRevenue > 0 ? Math.round((grossProfit / closedRevenue) * 10000) / 10000 : 0;
    const netProfit = Math.round((closedRevenue - costTotal) * 100) / 100;
    const netTargetGap = Math.round((cfg.net_profit_target_monthly - netProfit) * 100) / 100;

    const opps = await Opportunity.find();
    const isClosed = (o: any) => {
      const s = String(o.stage || '').toLowerCase();
      const c = String(o.contract_status || '').toLowerCase();
      return s.includes('closed') || c.includes('won') || c.includes('lost');
    };
    const isWon = (o: any) => {
      const s = String(o.stage || '').toLowerCase();
      const c = String(o.contract_status || '').toLowerCase();
      return s.includes('closed won') || (c.includes('won') && !c.includes('lost'));
    };
    const dealVal = (o: any) => {
      const v = Number(o.final_price) > 0 ? Number(o.final_price) : Number(o.estimated_value);
      return isNaN(v) || v <= 0 ? 0 : v;
    };
    const stageWeight = (stageRaw: string, contractRaw: string) => {
      const s = String(stageRaw || '').toLowerCase();
      const c = String(contractRaw || '').toLowerCase();
      if (c.includes('won')) return 0.9;
      if (s.includes('negotiat')) return 0.6;
      if (s.includes('proposal')) return 0.4;
      if (s.includes('scop') || s.includes('qualif') || s.includes('requirement')) return 0.25;
      if (s.includes('discovery') || s.includes('meeting')) return 0.15;
      if (s.includes('new') || s.includes('open')) return 0.1;
      return 0.1;
    };

    let weightedPipeline = 0;
    let openOpps = 0;
    let wonCount = 0;
    let wonValueSum = 0;
    let totalConsidered = 0;

    for (const o of opps) {
      totalConsidered++;
      if (isWon(o)) {
        wonCount++;
        const v = dealVal(o);
        if (v > 0) wonValueSum += v;
      }
      if (!isClosed(o)) {
        openOpps++;
        const v = dealVal(o) || ((cfg.price_min + cfg.price_max) / 2);
        weightedPipeline += v * stageWeight(o.stage, o.contract_status);
      }
    }
    weightedPipeline = Math.round(weightedPipeline * 100) / 100;

    let conversionRate = totalConsidered > 0 ? wonCount / totalConsidered : cfg.conversion_opp_to_won;
    conversionRate = Math.round(conversionRate * 10000) / 10000;
    
    let avgDeal = wonCount > 0 && wonValueSum > 0 ? wonValueSum / wonCount : (cfg.price_min + cfg.price_max) / 2;
    avgDeal = Math.round(avgDeal * 100) / 100;

    const leads = await Lead.find();
    let openLeads = 0;
    for (const l of leads) {
      const s = String(l.status || '').toLowerCase();
      if (!s.includes('won') && !s.includes('lost') && !s.includes('suppress')) openLeads++;
    }

    const targetGap = Math.round((cfg.revenue_target_monthly - closedRevenue) * 100) / 100;
    const effConv = conversionRate > 0 ? conversionRate : cfg.conversion_opp_to_won;
    const effAvg = avgDeal > 0 ? avgDeal : (cfg.price_min + cfg.price_max) / 2;

    let requiredOpps = 0, requiredLeads = 0, requiredConversations = 0, requiredOutreach = 0;
    if (targetGap > 0) {
      const dealsNeededRaw = targetGap / effAvg;
      const pipelineDeals = effAvg > 0 ? (weightedPipeline / effAvg) : 0;
      const netDeals = Math.max(0, dealsNeededRaw - pipelineDeals);
      requiredOpps = Math.ceil(netDeals / effConv);
      requiredLeads = cfg.conversion_lead_to_opp > 0 ? Math.ceil(requiredOpps / cfg.conversion_lead_to_opp) : requiredOpps;
      requiredConversations = cfg.conversion_conversation_opp > 0 ? Math.ceil(requiredOpps / cfg.conversion_conversation_opp) : requiredOpps;
      requiredOutreach = cfg.conversion_outreach_reply > 0 ? Math.ceil(requiredConversations / cfg.conversion_outreach_reply) : requiredConversations;
    }

    let directive = '';
    let directiveNote = '';
    let nextTier = 0;
    const pct = cfg.revenue_target_monthly > 0 ? Math.round((closedRevenue / cfg.revenue_target_monthly) * 1000) / 10 : 0;

    if (targetGap <= 0) {
      const tiers = [30000, 40000, 50000, 75000, 100000];
      nextTier = tiers.find(t => t > closedRevenue) || (Math.ceil(closedRevenue / 25000) * 25000 + 25000);
      directive = 'SCALE_UP';
      directiveNote = `Monthly minimum ($${cfg.revenue_target_monthly}) met at $${closedRevenue} (${pct}%). Pursue next tier $${nextTier} — keep sourcing/outreach/follow-up at full pace; do not idle.`;
    } else if (weightedPipeline >= targetGap) {
      directive = 'EXECUTE_PIPELINE';
      directiveNote = `Behind by $${targetGap} but weighted pipeline $${weightedPipeline} covers the gap. Prioritise converting existing opportunities: follow-ups, proposals, negotiation, closing.`;
    } else {
      directive = 'GENERATE_PIPELINE';
      directiveNote = `Behind by $${targetGap}; pipeline $${weightedPipeline} insufficient. Ramp discovery + outreach: ~${requiredOutreach} outreach, ~${requiredConversations} conversations, ~${requiredOpps} new opportunities needed this month.`;
    }

    const profitNote = costsUnset
      ? ` | NET PROFIT: costs unset (cost_fixed_monthly & cost_variable_percent = 0) — net_profit falls back to closed_revenue ($${netProfit}). Net target $${cfg.net_profit_target_monthly}, gap $${netTargetGap}. Enter real cost data for accurate profit.`
      : ` | NET PROFIT: $${netProfit} (revenue $${closedRevenue} − cost $${costTotal}), gross margin ${Math.round(grossMargin * 1000) / 10}%. Net target $${cfg.net_profit_target_monthly}, gap $${netTargetGap}.`;
    directiveNote += profitNote;

    const snapshot_id = `SNAP-${period}`;
    await Analytics.findOneAndUpdate({ snapshot_id }, {
      snapshot_id, period,
      revenue_target: cfg.revenue_target_monthly, closed_revenue: closedRevenue, target_gap: targetGap,
      weighted_pipeline: weightedPipeline, open_opportunities: openOpps, conversion_rate: conversionRate,
      avg_deal_value: avgDeal, required_leads: requiredLeads, required_opportunities: requiredOpps,
      required_conversations: requiredConversations, required_outreach: requiredOutreach,
      cost_total: costTotal, gross_profit: grossProfit, gross_margin: grossMargin,
      net_profit: netProfit, net_target: cfg.net_profit_target_monthly, net_target_gap: netTargetGap,
      directive, notes: directiveNote
    } as any, { upsert: true });

    const execution_id = `exec-analytics-${Date.now()}`;
    await Log.create({
      execution_id, workflow: 'VYNORA-W15-Analytics-Revenue-Control', entity_id: snapshot_id,
      action: `Analytics ${period}: closed $${closedRevenue}/${cfg.revenue_target_monthly}, net $${netProfit}/${cfg.net_profit_target_monthly} (gap $${netTargetGap}), directive ${directive}`,
      result: directive, severity: 'Low', human_approval: false, log_time: new Date()
    } as any);

    if (directive === 'GENERATE_PIPELINE') {
      const msg = `Monthly revenue control snapshot ${period}:

Closed (verified): $${closedRevenue}
Revenue target: $${cfg.revenue_target_monthly}
Revenue gap: $${targetGap}

— PROFITABILITY —
Cost (total this month): $${costTotal}
Gross profit: $${grossProfit}
Gross margin: ${grossMargin}
Net profit: $${netProfit}
Net profit target: $${cfg.net_profit_target_monthly}
Net profit gap: $${netTargetGap}

Weighted pipeline: $${weightedPipeline}
Open opportunities: ${openOpps}
Conversion rate: ${conversionRate}
Avg deal value: $${avgDeal}

Required this month:
- Outreach: ${requiredOutreach}
- Conversations: ${requiredConversations}
- New opportunities: ${requiredOpps}
- New leads: ${requiredLeads}

Directive: ${directive}
${directiveNote}

— VYNORA Autonomous BDM`;
      await this.sendEmail(cfg.approval_email, `[VYNORA] Revenue behind target — ${period} ($${closedRevenue}/${cfg.revenue_target_monthly})`, msg);
    }

    return {
      snapshot_id, period, revenue_target: cfg.revenue_target_monthly, closed_revenue: closedRevenue,
      target_gap: targetGap, directive
    };
  }
}

export const analyticsEngineService = new AnalyticsEngineService();
