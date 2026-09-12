import { Config } from '../models/Config';
import { Opportunity } from '../models/Opportunity';
import { Payment } from '../models/Payment';
import { Approval } from '../models/Approval';
import { Project } from '../models/Project';
import { Log } from '../models/Log';

export class FinanceService {

  private async getConfig() {
    const configs = await Config.find({ is_active: true });
    const cfg: Record<string, string> = {};
    configs.forEach(c => cfg[c.config_key] = c.config_value);

    const num = (k: string, d: number) => {
      const v = Number(cfg[k]);
      return isNaN(v) ? d : v;
    };
    const bool = (k: string) => String(cfg[k]).toLowerCase() === 'true';

    let split = [50, 0, 50];
    try {
      if (cfg.payment_split_percent) {
        const arr = String(cfg.payment_split_percent).replace(/[\[\]\s]/g, '').split(',').map(Number).filter(n => !isNaN(n));
        if (arr.length === 3) split = arr;
      }
    } catch (e) {}

    return {
      currency: cfg.currency || 'USD',
      price_min: num('price_min', 500),
      price_max: num('price_max', 3000),
      split_upfront: split[0],
      split_milestone: split[1],
      split_final: split[2],
      approval_email: cfg.approval_email || '',
      paypal_enabled: bool('paypal_enabled'),
      binance_enabled: bool('binance_enabled')
    };
  }

  private async logEvent(opportunity_id: string, action: string, result: string, severity: string, event_id?: string, human_approval: boolean = false) {
    await Log.create({
      execution_id: `exec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      workflow: 'VYNORA-W04-Finance-Handoff',
      entity_id: opportunity_id || 'unknown',
      action,
      result,
      severity,
      human_approval,
      event_id,
      log_time: new Date()
    });
  }

  async handlePaymentRequest(body: any) {
    const cfg = await this.getConfig();
    const opportunity_id = body.opportunity_id;
    let stage = String(body.stage || '').toLowerCase();
    if (!['upfront', 'milestone', 'final'].includes(stage)) stage = 'upfront';

    if (!opportunity_id) {
      await this.logEvent('unknown', 'Payment request blocked - opportunity not found', 'Blocked', 'Medium');
      return { success: false, message: 'Opportunity ID missing' };
    }

    const opp = await Opportunity.findOne({ opportunity_id });
    if (!opp) {
      await this.logEvent(opportunity_id, 'Payment request blocked - opportunity not found', 'Blocked', 'Medium');
      return { success: false, message: 'Opportunity not found' };
    }

    const won = ['approved', 'won', 'signed'].includes(String(opp.contract_status).toLowerCase());
    if (!won) {
      await this.logEvent(opportunity_id, `Payment request blocked - deal not Won (${opp.contract_status})`, 'Blocked', 'Medium');
      return { success: false, message: 'Deal not won' };
    }

    const final_price = opp.final_price || 0;
    const pct = Number(stage === 'upfront' ? cfg.split_upfront : (stage === 'milestone' ? cfg.split_milestone : cfg.split_final)) || 0;
    const amount = Math.round(final_price * (pct / 100) * 100) / 100;

    if (final_price <= 0 || amount <= 0) {
      await this.logEvent(opportunity_id, 'Payment request invalid: final_price missing or zero', 'Invalid', 'Medium');
      return { success: false, message: 'Invalid price' };
    }

    const payment_id = `REQ-${opportunity_id}-${stage}`;
    const existing = await Payment.findOne({ payment_id });
    if (existing) {
      await this.logEvent(opportunity_id, `Duplicate payment request ignored (${payment_id} already exists)`, 'Skipped', 'Low', payment_id);
      return { success: true, message: 'Duplicate request ignored' };
    }

    const out_of_range = final_price < cfg.price_min || final_price > cfg.price_max;

    if (out_of_range) {
      const reason = `final_price ${final_price} outside allowed range ${cfg.price_min}-${cfg.price_max}`;
      await Approval.create({
        approval_id: `APR-${payment_id}`,
        entity_type: 'payment_request',
        entity_id: payment_id,
        opportunity_id,
        reason: `Unusual commercial terms: ${reason}`,
        requested_action: `Approve ${stage} payment request for ${cfg.currency} ${amount}`,
        details: JSON.stringify({ stage, amount, final_price, pct }),
        approval_token: String(Date.now())
      });
      await this.logEvent(opportunity_id, `Payment request held for approval (unusual terms): ${reason}`, 'Pending Approval', 'Medium', payment_id, true);
      return { success: true, message: 'Sent for approval due to unusual terms' };
    }

    await Payment.create({
      payment_id,
      event_id: `req-${opportunity_id}-${stage}`,
      opportunity_id,
      event_type: `PAYMENT.REQUESTED.${stage.toUpperCase()}`,
      amount,
      currency: cfg.currency,
      status: 'Payment Requested',
      provider: 'pending'
    });

    opp.payment_status = `Awaiting ${stage} payment`;
    opp.stage = 'Payment Requested';
    await opp.save();

    await this.logEvent(opportunity_id, `Payment request created (${stage} = ${cfg.currency} ${amount})`, 'Payment Requested', 'Low', payment_id);
    return { success: true, message: 'Payment request created' };
  }

  async handlePaymentEvent(body: any) {
    const cfg = await this.getConfig();
    const event_id = body.event_id || `evt-${Date.now()}`;
    const opportunity_id = body.opportunity_id;
    let stage = String(body.stage || '').toLowerCase();
    if (!['upfront', 'milestone', 'final'].includes(stage)) stage = 'upfront';

    let amount = Number(String(body.amount).replace(/[^0-9.]/g, ''));
    if (!isFinite(amount)) amount = 0;
    
    const currency = body.currency || 'USD';
    const provider = String(body.provider || '').toLowerCase();
    const verification_result = String(body.verification_result || '').toLowerCase();
    const verification_source = String(body.verification_source || '').toLowerCase();

    if (!opportunity_id) {
      await this.logEvent('unknown', 'Payment event for unknown opportunity — nothing recorded', 'Blocked', 'Medium', event_id);
      return { success: false, message: 'Missing opportunity ID' };
    }

    const dupRow = await Payment.findOne({ event_id });
    if (dupRow) {
      await this.logEvent(opportunity_id, `Duplicate payment event ignored (event_id=${event_id})`, 'Skipped', 'Low', event_id);
      return { success: true, message: 'Duplicate event' };
    }

    const opp = await Opportunity.findOne({ opportunity_id });
    if (!opp) {
      await this.logEvent(opportunity_id, 'Payment event for unknown opportunity — nothing recorded', 'Blocked', 'Medium', event_id);
      return { success: false, message: 'Opportunity not found' };
    }

    const stage_payment_id = `PAY-${opportunity_id}-${stage}`;
    const stageRow = await Payment.findOne({ payment_id: stage_payment_id });
    if (stageRow && stageRow.status.toLowerCase().includes('paid')) {
      await this.logEvent(opportunity_id, `Payment event ignored — stage already recorded (${stage_payment_id})`, 'Skipped', 'Low', event_id);
      return { success: true, message: 'Stage already recorded' };
    }

    const trusted = ['human'];
    if (cfg.paypal_enabled) trusted.push('paypal_webhook');
    if (cfg.binance_enabled) trusted.push('binance_webhook');
    
    const source_trusted = trusted.includes(verification_source);
    const is_verified = verification_result === 'verified' && source_trusted;

    const final_price = opp.final_price || 0;
    if (final_price <= 0) {
      await this.logEvent(opportunity_id, 'Payment event invalid: opportunity has no final_price', 'Invalid', 'Medium', event_id);
      return { success: false, message: 'Invalid final_price' };
    }

    const pct = Number(stage === 'upfront' ? cfg.split_upfront : (stage === 'milestone' ? cfg.split_milestone : cfg.split_final)) || 0;
    const expected = Math.round(final_price * (pct / 100) * 100) / 100;
    const tolerance = 0.01;
    const amount_ok = expected > 0 && amount >= (expected - tolerance);
    const shortfall = Math.round((expected - amount) * 100) / 100;

    if (!is_verified) {
      const note = verification_result === 'failed' 
        ? `verification FAILED from source ${verification_source}`
        : `verification not from a trusted/enabled source (${verification_source}); result=${verification_result}`;
      
      await Payment.create({
        payment_id: `PENDING-${event_id}`,
        event_id,
        opportunity_id,
        event_type: `PAYMENT.UNVERIFIED.${stage.toUpperCase()}`,
        amount,
        currency,
        status: 'Pending Verification',
        provider: verification_source || 'unknown'
      });

      await Approval.create({
        approval_id: `APR-VERIFY-${event_id}`,
        entity_type: 'payment',
        entity_id: event_id,
        opportunity_id,
        reason: `Payment could not be trusted-verified: ${note}`,
        requested_action: 'Verify payment via a trusted source, then re-send payment_event with verification_source=human, verification_result=verified',
        details: JSON.stringify({ stage, amount, claimed_source: verification_source, result: verification_result }),
        approval_token: String(Date.now())
      });

      await this.logEvent(opportunity_id, `Payment NOT verified (held): ${note}`, 'Verification Hold', 'High', event_id, true);
      return { success: true, message: 'Held for verification' };
    }

    if (!amount_ok) {
      const note = `received ${amount} < expected ${expected} (shortfall ${shortfall > 0 ? shortfall : 0})`;
      await Payment.create({
        payment_id: `HELD-${event_id}`,
        event_id,
        opportunity_id,
        event_type: `PAYMENT.MISMATCH.${stage.toUpperCase()}`,
        amount,
        currency,
        status: 'Held - Amount Mismatch',
        provider: verification_source
      });

      await Approval.create({
        approval_id: `APR-MISMATCH-${event_id}`,
        entity_type: 'payment',
        entity_id: event_id,
        opportunity_id,
        reason: `Amount mismatch: ${note}`,
        requested_action: 'Reconcile the payment manually; do not mark paid until resolved',
        details: JSON.stringify({ expected, received: amount, shortfall }),
        approval_token: String(Date.now())
      });

      await this.logEvent(opportunity_id, `Payment held — amount mismatch: ${note}`, 'Held', 'High', event_id, true);
      return { success: true, message: 'Held for amount mismatch' };
    }

    const payment_status_label = stage.charAt(0).toUpperCase() + stage.slice(1) + ' Paid';
    
    await Payment.create({
      payment_id: stage_payment_id,
      event_id,
      opportunity_id,
      project_id: `PROJ-${opportunity_id.replace('OPP-', '')}`,
      event_type: `PAYMENT.VERIFIED.${stage.toUpperCase()}`,
      amount,
      currency,
      status: payment_status_label,
      provider: verification_source
    });

    opp.payment_status = payment_status_label;
    await opp.save();

    if (stage === 'upfront') {
      const existingProj = await Project.findOne({ opportunity_id });
      if (existingProj) {
        await this.logEvent(opportunity_id, 'Upfront payment verified; project already existed (no duplicate created)', 'Upfront Paid', 'Low', event_id);
      } else {
        await Project.create({
          project_id: `PROJ-${opportunity_id.replace('OPP-', '')}`,
          opportunity_id,
          client: '',
          sow: '',
          assigned_developer: '',
          repository: '',
          environment: ''
        });
        await this.logEvent(opportunity_id, `Upfront payment verified (${verification_source}); project provisioned`, 'Upfront Paid', 'Low', event_id);
      }
    } else if (stage === 'milestone') {
      await this.logEvent(opportunity_id, `Milestone payment verified (${verification_source})`, 'Milestone Paid', 'Low', event_id);
    } else if (stage === 'final') {
      await Approval.create({
        approval_id: `APR-HANDOFF-${opportunity_id}`,
        entity_type: 'handover',
        entity_id: `PROJ-${opportunity_id.replace('OPP-', '')}`,
        opportunity_id,
        reason: 'Final payment verified — delivery handoff requires human approval',
        requested_action: `Approve delivery handoff for ${opportunity_id} via handoff_decision`,
        details: JSON.stringify({ final_amount: amount, currency, verified_by: verification_source }),
        approval_token: String(Date.now())
      });
      await this.logEvent(opportunity_id, 'Final payment verified; handoff approval created (awaiting human decision)', 'Final Paid - Awaiting Handoff', 'Low', event_id, true);
    }

    return { success: true, message: 'Payment successfully processed' };
  }

  async handleHandoffDecision(body: any) {
    const decision = String(body.decision || '').toLowerCase();
    const decided_by = body.decided_by || 'human';
    const opportunity_id = body.opportunity_id;

    if (!opportunity_id) return { success: false, message: 'Missing opportunity_id' };

    const opp = await Opportunity.findOne({ opportunity_id });
    const proj = await Project.findOne({ opportunity_id });
    const finalPay = await Payment.findOne({ payment_id: `PAY-${opportunity_id}-final` });

    const project_found = !!proj;
    const final_paid = finalPay && finalPay.status.toLowerCase().includes('paid');

    const done = (v: any) => ['passed', 'deployed', 'complete', 'completed', 'done'].includes(String(v || '').toLowerCase());
    
    const qa_ok = proj && done(proj.qa_status);
    const deploy_ok = proj && done(proj.deployment_status);
    const has_repo = proj && !!proj.repository;
    
    const ready = project_found && qa_ok && deploy_ok && has_repo;

    const blockers = [];
    if (!project_found) blockers.push('project not found');
    if (proj && !qa_ok) blockers.push(`QA not passed (${proj.qa_status || 'empty'})`);
    if (proj && !deploy_ok) blockers.push(`deployment not complete (${proj.deployment_status || 'empty'})`);
    if (proj && !has_repo) blockers.push('repository not set');
    if (!final_paid) blockers.push('final payment not verified/recorded');

    if (decision !== 'approve' || !final_paid || !ready) {
      let note = '';
      if (decision !== 'approve') note = `handoff not approved by human (decision=${decision || 'none'})`;
      else if (!final_paid) note = 'final payment not verified/recorded';
      else note = `readiness blockers: ${blockers.join('; ')}`;

      const approval = await Approval.findOne({ approval_id: `APR-HANDOFF-${opportunity_id}` });
      if (approval) {
        approval.status = 'Held';
        approval.decided_by = decided_by;
        approval.decided_at = new Date();
        approval.decision_notes = note;
        await approval.save();
      }
      
      await this.logEvent(opportunity_id, `Handoff not completed: ${note}`, 'Handover Held', 'Medium', undefined, true);
      return { success: false, message: 'Handover held', blockers };
    }

    const summary = [
      'Project handover package',
      `Project: ${proj.project_id} (${opportunity_id})`,
      `Client: ${proj.client || ''}`,
      `Assigned developer: ${proj.assigned_developer || ''}`,
      `Repository: ${proj.repository || ''}`,
      `Environment: ${proj.environment || ''}`,
      `QA status: ${proj.qa_status || ''}`,
      `Deployment status: ${proj.deployment_status || ''}`,
      '',
      'Access note: repository and environment credentials are provisioned through the secure vault out-of-band. This package contains NO secrets.'
    ].join('\n');

    proj.handover_status = 'Handed Over';
    proj.sow = summary;
    await proj.save();

    if (opp) {
      opp.stage = 'Delivered';
      opp.payment_status = 'Final Paid';
      await opp.save();
    }

    const approval = await Approval.findOne({ approval_id: `APR-HANDOFF-${opportunity_id}` });
    if (approval) {
      approval.status = 'Approved';
      approval.decided_by = decided_by;
      approval.decided_at = new Date();
      approval.decision_notes = 'Handoff approved and completed';
      await approval.save();
    }

    await this.logEvent(opportunity_id, 'Final paid + human approved; controlled handover completed (no raw credentials transmitted)', 'Handed Over', 'Low', undefined, true);
    
    return { success: true, message: 'Handover completed' };
  }
}
