import { Config } from '../models/Config';
import { Log } from '../models/Log';
import { Analytics } from '../models/Analytics';
import { analyticsEngineService } from './analyticsEngine.service';
import { leadSourcingService } from './leadSourcing.service';
import { outboundMachineService } from './outboundMachine.service';
import { followupEngineService } from './followupEngine.service';
import { DateTime } from 'luxon';

export class ControlLoopService {
  private async getConfig() {
    const configs = await Config.find({ is_active: true });
    const cfg: Record<string, string> = {};
    configs.forEach(c => cfg[c.config_key] = c.config_value);
    
    return {
      control_loop_cooldown_min: Number(cfg.control_loop_cooldown_min) || 60,
      control_loop_daily_cap: Number(cfg.control_loop_daily_cap) || 6,
      approval_email: process.env.APPROVAL_EMAIL || cfg.approval_email
    };
  }

  async runCycle(manual: boolean = false) {
    const cfg = await this.getConfig();
    const now = new Date();
    
    // Timezone aware business day start (Asia/Kolkata)
    const dayStartMs = DateTime.now().setZone('Asia/Kolkata').startOf('day').toMillis();
    const nowMs = now.getTime();

    // Check recent runs for cooldown and daily cap
    const runs = await Log.find({ workflow: 'VYNORA-W16-Control-Loop' }).sort({ log_time: -1 });
    const seen: Record<string, boolean> = {};
    let lastStart = 0;
    let todayCount = 0;

    for (const r of runs) {
      const action = String(r.action || '');
      const result = String(r.result || '');
      if (result !== 'Started' || action.indexOf('Control cycle START') !== 0) continue;
      
      const t = r.log_time ? new Date(r.log_time).getTime() : 0;
      if (t <= 0) continue;
      
      if (t > lastStart) lastStart = t;
      const key = String(r.entity_id || r.execution_id || t);
      
      if (t >= dayStartMs && !seen[key]) {
        seen[key] = true;
        todayCount++;
      }
    }

    const minsSince = lastStart > 0 ? (nowMs - lastStart) / 60000 : Infinity;
    let allowed = true;
    let reason = 'ok';

    if (!manual) {
      if (todayCount >= cfg.control_loop_daily_cap) {
        allowed = false;
        reason = `Daily control-loop cap reached (${todayCount}/${cfg.control_loop_daily_cap})`;
      } else if (minsSince < cfg.control_loop_cooldown_min) {
        allowed = false;
        reason = `Cooldown active — ${Math.round(minsSince)}min since last cycle (< ${cfg.control_loop_cooldown_min}min)`;
      }
    }

    const timestamp = DateTime.now().toFormat('yyyyLLddHHmmss');
    const cycle_id = `CYCLE-${timestamp}`;
    const execution_id = `exec-control-${Date.now()}`;

    if (!allowed) {
      await Log.create({
        execution_id, workflow: 'VYNORA-W16-Control-Loop', entity_id: cycle_id,
        action: `Control cycle SKIPPED — ${reason}`, result: 'Skipped',
        severity: 'Low', human_approval: false, log_time: new Date()
      } as any);
      return { status: 'skipped', reason, cycle_id };
    }

    // Start Cycle
    await Log.create({
      execution_id, workflow: 'VYNORA-W16-Control-Loop', entity_id: cycle_id,
      action: `Control cycle START (${cycle_id})`, result: 'Started',
      severity: 'Low', human_approval: false, log_time: new Date()
    } as any);

    let directive = 'GENERATE_PIPELINE';
    let notes = 'No snapshot found — defaulting to GENERATE_PIPELINE';

    // Run Analytics
    try {
      const analyticsResult = await analyticsEngineService.runAnalytics();
      directive = analyticsResult.directive || 'GENERATE_PIPELINE';
      
      // Read latest directive directly from DB to get the notes
      const latest = await Analytics.findOne().sort({ period: -1 });
      if (latest) {
        notes = latest.notes || notes;
      }
    } catch (e: any) {
      await Log.create({
        execution_id, workflow: 'VYNORA-W16-Control-Loop', entity_id: cycle_id,
        action: `Control cycle ABORTED — W15 analytics failed; no fresh directive, cycle stopped without dispatch (fail-safe).`,
        result: 'Skipped', severity: 'High', human_approval: false, log_time: new Date()
      } as any);
      return { status: 'aborted', error: e.message, cycle_id };
    }

    const invoked_by = `W16:${cycle_id}`;
    let dispatched = '';

    // Route Directive
    if (directive === 'GENERATE_PIPELINE') {
      dispatched = 'W10+W01+W11';
      await leadSourcingService.runSourcing(invoked_by);
      await outboundMachineService.runMachine(invoked_by);
      await followupEngineService.runFollowups(invoked_by);
      
      await Log.create({
        execution_id, workflow: 'VYNORA-W16-Control-Loop', entity_id: cycle_id,
        action: `Control cycle COMPLETE — GENERATE_PIPELINE (${dispatched}). ${notes}`,
        result: 'Completed', severity: 'Low', human_approval: false, log_time: new Date()
      } as any);
    } else if (directive === 'EXECUTE_PIPELINE') {
      dispatched = 'W01+W11';
      await outboundMachineService.runMachine(invoked_by);
      await followupEngineService.runFollowups(invoked_by);

      await Log.create({
        execution_id, workflow: 'VYNORA-W16-Control-Loop', entity_id: cycle_id,
        action: `Control cycle COMPLETE — EXECUTE_PIPELINE (${dispatched}). ${notes}`,
        result: 'Completed', severity: 'Low', human_approval: false, log_time: new Date()
      } as any);
    } else if (directive === 'SCALE_UP') {
      dispatched = 'W10+W01+W11';
      await leadSourcingService.runSourcing(invoked_by);
      await outboundMachineService.runMachine(invoked_by);
      await followupEngineService.runFollowups(invoked_by);

      await Log.create({
        execution_id, workflow: 'VYNORA-W16-Control-Loop', entity_id: cycle_id,
        action: `Control cycle COMPLETE — SCALE_UP (${dispatched}). ${notes}`,
        result: 'Completed', severity: 'Low', human_approval: false, log_time: new Date()
      } as any);
    } else {
      await Log.create({
        execution_id, workflow: 'VYNORA-W16-Control-Loop', entity_id: cycle_id,
        action: `Control cycle COMPLETE — unknown directive ${directive}, no engines dispatched (safe no-op).`,
        result: 'Completed', severity: 'Low', human_approval: false, log_time: new Date()
      } as any);
    }

    return {
      status: 'completed',
      cycle_id,
      directive,
      dispatched
    };
  }
}

export const controlLoopService = new ControlLoopService();
