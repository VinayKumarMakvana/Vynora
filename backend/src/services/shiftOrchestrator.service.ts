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
      console.log('Phase 2: AI Needs Analysis & Verification...');
      const newLeads = await Lead.find({ status: 'new', outreach_eligible: false });
      
      for (const lead of newLeads) {
        // Mock Needs Analysis - Using Gemini AI to decide Pain Point & Service
        const prompt = `Analyze this B2B Lead and identify their most likely digital pain point and the most relevant service VYNORA can offer (e.g. Website Redesign, SEO, AI Automation).
        Lead Name: ${lead.raw_name || lead.company}
        Domain: ${lead.domain}
        Category: ${lead.category || 'Business'}
        
        Return ONLY a JSON object: {"pain_point": "...", "relevant_service": "...", "priority": "High/Medium/Low"}`;

        const aiResult = await aiGatewayService.processAiRequest({ prompt, system_prompt: 'You are an expert B2B research analyst.', max_tokens: 150 });
        
        let pain_point = 'outdated digital presence';
        let relevant_service = 'website redesign';
        let priority = 'Medium';

        if (aiResult.success) {
          try {
            const cleanedText = aiResult.text.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
            const p = JSON.parse(cleanedText);
            if (p.pain_point) pain_point = p.pain_point;
            if (p.relevant_service) relevant_service = p.relevant_service;
            if (p.priority) priority = p.priority;
          } catch(e) {}
        }

        // Save Research (upsert to avoid duplicate key crash if lead is re-processed)
        await Research.findOneAndUpdate(
          { lead_id: lead.lead_id },
          {
            research_id: `RES-${lead.lead_id}`,
            lead_id: lead.lead_id,
            company_id: lead.company_id,
            likely_pain_point: pain_point,
            relevant_service: relevant_service,
            status: 'completed'
          },
          { upsert: true }
        );

        // Verify and Mark Eligible
        lead.outreach_eligible = true;
        await lead.save();
      }

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
