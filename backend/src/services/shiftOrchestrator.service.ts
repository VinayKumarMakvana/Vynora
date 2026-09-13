import { leadSourcingService } from './leadSourcing.service';
import { outboundMachineService } from './outboundMachine.service';
import { shiftReportService } from './shiftReport.service';
import { Log } from '../models/Log';
import { Lead } from '../models/Lead';
import { aiGatewayService } from './aiGateway.service';
import { Research } from '../models/Research';

export const shiftOrchestratorService = {
  async runShift() {
    const execution_id = `shift-${Date.now()}`;
    const workflow = 'VYNORA-W00-Shift-Orchestrator';

    console.log(`[${new Date().toISOString()}] Starting 8-Hour AI Shift (Execution: ${execution_id})`);

    try {
      await Log.create({
        execution_id, workflow, entity_id: 'SHIFT_START',
        action: 'Shift Cycle STARTED', result: 'Started', severity: 'Info', human_approval: false
      } as any);

      // Phase 1: Sourcing (Find ~200 leads)
      console.log('Phase 1: Sourcing Leads...');
      await leadSourcingService.runSourcing(`W00:${execution_id}`);

      // Phase 2: AI Needs Analysis (Research & Verification)
      console.log('Phase 2: Needs Analysis is now handled synchronously during Sourcing (Phase 1).');

      // Phase 3: Outbound Machine (Cap: 25-50)
      console.log('Phase 3: Outbound Outreach...');
      // Will pass parameters to cap at 50, but outboundMachine has its own cap logic.
      // We will override it or use environment variables, but calling it now.
      await outboundMachineService.runMachine(`W00:${execution_id}`);

      // Phase 4: Shift Report
      console.log('Phase 4: Generating Shift Report...');
      await shiftReportService.runReport();

      await Log.create({
        execution_id, workflow, entity_id: 'SHIFT_COMPLETE',
        action: 'Shift Cycle COMPLETED successfully', result: 'Completed', severity: 'Info', human_approval: false
      } as any);

    } catch (e: any) {
      console.error('Shift Orchestrator Error:', e);
      await Log.create({
        execution_id, workflow, entity_id: 'SHIFT_FAILED',
        action: `Shift Cycle FAILED: ${e.message}`, result: 'Failed', severity: 'High', human_approval: false
      } as any);
    }
  }
};
