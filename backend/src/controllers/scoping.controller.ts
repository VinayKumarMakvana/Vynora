import { Request, Response } from 'express';
import axios from 'axios';
import { Opportunity } from '../models/Opportunity';
import { Lead } from '../models/Lead';
import { Contact } from '../models/Contact';
import { Company } from '../models/Company';
import { Conversation } from '../models/Conversation';
import { Message } from '../models/Message';
import { Requirement } from '../models/Requirement';
import { Log } from '../models/Log';
import { aiGatewayService } from '../services/aiGateway.service';

export const scopingController = {
  async handleMeetingScope(req: Request, res: Response): Promise<any> {
    const wf = 'VYNORA-W03-Requirements-Scoping';
    const body = req.body;
    const oppId = body.opportunity_id;
    const exec_id = `exec-${Date.now()}`;

    if (!oppId) {
      await Log.create({ execution_id: exec_id, workflow: wf, entity_id: 'unknown', action: 'Missing opportunity_id', result: 'Invalid' });
      return res.status(400).json({ status: 'error', error: 'Missing opportunity_id' });
    }

    try {
      const opp = await Opportunity.findOne({ opportunity_id: oppId });
      if (!opp) {
        await Log.create({ execution_id: exec_id, workflow: wf, entity_id: oppId, action: 'Opportunity not found', result: 'Missing Context', human_approval: true });
        return res.status(404).json({ status: 'error', reason: 'missing_context', opportunity_id: oppId });
      }

      const lead = await Lead.findOne({ opportunity_id: oppId });
      const contactId = body.contact_id || lead?.contact_id;
      const contact = contactId ? await Contact.findOne({ contact_id: contactId }) : null;
      const companyId = body.company_id || lead?.company_id;
      const company = companyId ? await Company.findOne({ company_id: companyId }) : null;
      const conv = await Conversation.findOne({ opportunity_id: oppId });
      const msgs = await Message.find({ opportunity_id: oppId, direction: 'inbound' });
      const reqDoc = await Requirement.findOne({ opportunity_id: oppId });

      let convo_text = '';
      if (body.transcript) convo_text += `[Transcript]\n${body.transcript}\n\n`;
      if (msgs.length) convo_text += `[Messages]\n${msgs.map(m => `[${m.subject}] ${m.body}`).join('\n')}\n\n`;
      if (conv?.pain_point) convo_text += `[Known pain point] ${conv.pain_point}\n\n`;
      if (conv?.intent) convo_text += `[Known intent] ${conv.intent}\n\n`;
      convo_text = convo_text.trim();

      const known = reqDoc ? `
business_problem: ${reqDoc.business_problem || ''}
desired_solution: ${reqDoc.desired_solution || ''}
scope: ${reqDoc.scope || ''}
features: ${reqDoc.features || ''}
complexity: ${reqDoc.complexity || ''}
timeline: ${reqDoc.timeline || ''}
budget: ${reqDoc.budget || ''}`.trim() : '';

      if (!convo_text && !known) {
        await Log.create({ execution_id: exec_id, workflow: wf, entity_id: oppId, action: 'No discovery material', result: 'Needs Input', human_approval: true });
        return res.status(200).json({ status: 'needs_input', reason: 'no_discovery_material', opportunity_id: oppId });
      }

      const sysPrompt = 'You are a senior solutions architect scoping a project. Extract ONLY what the client stated. Never invent facts. Output ONLY JSON: { business_problem, desired_solution, scope, features, integrations, platform, technology, users, complexity: "low|medium|high|unknown", timeline, budget, assumptions: [], missing_items: [], critical_missing: boolean }';
      const prompt = `Extract requirements for ${company?.name} (${contact?.name}). Service: ${opp?.service}.\n\nConfirmed requirements:\n${known || '(none)'}\n\nDiscovery material:\n${convo_text}`;

      const ai = await aiGatewayService.processAiRequest({ prompt, system_prompt: sysPrompt, temperature: 0, max_tokens: 1200 });

      if (!ai.success) {
        opp.scope_status = 'Scoping Deferred';
        await opp.save();
        await Log.create({ execution_id: exec_id, workflow: wf, entity_id: oppId, action: 'AI unavailable', result: 'Deferred', error: ai.error });
        return res.status(200).json({ status: 'deferred', reason: 'ai_unavailable', opportunity_id: oppId });
      }

      let r: any = {};
      try { r = JSON.parse(ai.text.replace(/^\s*```json\s*/i,'').replace(/```\s*$/,'').trim()); } catch(e){}

      const arr = (v: any) => Array.isArray(v) ? v.join('; ') : (v || '');
      const s = (v: any) => String(v || '').trim();
      const critical = r.critical_missing === true || (!s(r.business_problem) && !s(r.scope) && !s(r.features));
      const reqId = reqDoc?.requirement_id || `REQ-${oppId}`;

      await Requirement.findOneAndUpdate(
        { requirement_id: reqId },
        {
          opportunity_id: oppId, lead_id: lead?.lead_id, meeting_id: body.meeting_id,
          business_problem: s(r.business_problem), desired_solution: s(r.desired_solution),
          scope: s(r.scope), features: s(r.features), integrations: s(r.integrations),
          platform: s(r.platform), technology: s(r.technology), users: s(r.users),
          complexity: s(r.complexity), timeline: s(r.timeline), budget: s(r.budget),
          assumptions: arr(r.assumptions), missing_items: arr(r.missing_items),
          status: critical ? 'Needs Clarification' : 'Scoped'
        },
        { upsert: true }
      );

      if (critical) {
        opp.scope_status = 'Needs Clarification';
        await opp.save();
        await Log.create({ execution_id: exec_id, workflow: wf, entity_id: oppId, action: 'Critical info missing', result: 'Needs Clarification', human_approval: true });
        return res.status(200).json({ status: 'needs_clarification', opportunity_id: oppId, requirement_id: reqId, missing_items: arr(r.missing_items) });
      }

      opp.scope_status = 'Scoped';
      opp.proposal_status = 'Requested';
      await opp.save();
      await Log.create({ execution_id: exec_id, workflow: wf, entity_id: oppId, action: 'Canonical requirements scoped', result: 'Scoped' });

      try {
        await axios.post('https://vynoravinay.app.n8n.cloud/webhook/vynora/proposal-intake', {
          opportunity_id: oppId, lead_id: lead?.lead_id, contact_id: contact?.contact_id, company_id: company?.company_id,
          name: contact?.name, email: contact?.email, bdm_owner: opp.bdm, pain_points: conv?.pain_point,
          recommended_service: opp.service, summary: s(r.scope)
        });
      } catch (e) {}

      res.status(200).json({ status: 'scoped', opportunity_id: oppId, requirement_id: reqId, handed_to: 'W06' });
    } catch (e: any) {
      console.error(e);
      await Log.create({ execution_id: exec_id, workflow: wf, entity_id: oppId, action: 'CRM write failed', result: 'CRM Write Failed', error: e.message, human_approval: true });
      res.status(500).json({ status: 'error', reason: 'crm_write_failed', opportunity_id: oppId });
    }
  }
};
