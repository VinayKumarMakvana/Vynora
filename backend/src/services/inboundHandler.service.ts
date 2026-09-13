import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import axios from 'axios';
import { Contact } from '../models/Contact';
import { Lead } from '../models/Lead';
import { Message } from '../models/Message';
import { Opportunity } from '../models/Opportunity';
import { Conversation } from '../models/Conversation';
import { Log } from '../models/Log';
import { aiGatewayService } from './aiGateway.service';

export const inboundHandlerService = {
  async pollUnreadEmails() {
    const wf = 'VYNORA-W02-Inbound-Reply-Handler';
    console.log(`[${new Date().toISOString()}] Polling unread emails...`);

    const imapConfig = {
      imap: {
        user: process.env.IMAP_USER || '',
        password: process.env.IMAP_PASS || '',
        host: process.env.IMAP_HOST || 'imap.gmail.com',
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 3000
      }
    };

    if (!imapConfig.imap.user) return console.log('IMAP credentials missing. Skipping poll.');

    let connection: any;
    try {
      connection = await imaps.connect(imapConfig);
      await connection.openBox('INBOX');

      const messages = await connection.search(['UNSEEN'], { bodies: ['HEADER', 'TEXT'], markSeen: false });

      for (const item of messages) {
        const headerPart = item.parts.find((p: any) => p.which === 'HEADER');
        const textPart = item.parts.find((p: any) => p.which === 'TEXT');
        if (!headerPart || !textPart) continue;

        const emailInfo = await simpleParser(headerPart.body + '\r\n\r\n' + textPart.body);
        const from = emailInfo.from?.value[0]?.address?.toLowerCase() || '';
        const subject = emailInfo.subject || '';
        const body = emailInfo.text || emailInfo.html || '';
        const messageId = emailInfo.messageId || `msg-${Date.now()}`;
        const exec_id = `exec-${Date.now()}`;

        // Check if already processed
        if (await Message.findOne({ idempotency_key: messageId, direction: 'inbound' })) {
          await connection.addFlags(item.attributes.uid, ['\\Seen']);
          await Log.create({ execution_id: exec_id, workflow: wf, entity_id: messageId, action: 'Duplicate', result: 'Duplicate', severity: 'Low' });
          continue;
        }

        const contact = await Contact.findOne({ email: from });
        const lead = contact ? await Lead.findOne({ contact_id: contact.contact_id }) : null;

        if (!contact || !lead) {
          await connection.addFlags(item.attributes.uid, ['\\Seen']);
          await Log.create({ execution_id: exec_id, workflow: wf, entity_id: from || 'unknown-email', action: 'Unmatched', result: 'Unmatched', severity: 'Medium', human_approval: true });
          continue;
        }

        if (contact.opt_out) {
          await connection.addFlags(item.attributes.uid, ['\\Seen']);
          await Log.create({ execution_id: exec_id, workflow: wf, entity_id: contact.contact_id, action: 'Opt-out', result: 'Opt-Out', severity: 'Low' });
          continue;
        }

        const oppId = lead.opportunity_id || `OPP-${lead.lead_id}`;
        const convId = `CONV-${lead.lead_id}`;

        // AI Classification
        const sysPrompt = 'You are an inbox triage analyst. Output ONLY JSON: { category, confidence, is_positive, sentiment, intent, pain_points, recommended_service, summary, suggested_next_action, next_best_action, unsubscribe }';
        const ai = await aiGatewayService.processAiRequest({ prompt: `Prospect: ${contact.name}\nSubject: ${subject}\nBody: ${body}`, system_prompt: sysPrompt, temperature: 0, max_tokens: 800 });
        
        let p: any = { category: 'Unknown', is_positive: false, recommended_service: 'Unknown', unsubscribe: false };
        if (ai.success) {
          try { Object.assign(p, JSON.parse(ai.text.replace(/^\s*```json\s*/i,'').replace(/```\s*$/,'').trim())); } catch (e) {}
        }

        const bucket = (['Interested', 'Meeting Request', 'Information Request', 'Follow-up'].includes(p.category) && p.is_positive) ? 'positive' : 
                       (['Not Interested', 'Wrong Contact', 'Out of Office', 'Spam/Irrelevant', 'Unsubscribe'].includes(p.category) ? 'negative' : 'unknown');

        if (bucket === 'positive') {
          await Lead.updateOne({ lead_id: lead.lead_id }, { qualification_status: p.category, stage: 'Engaged', status: 'active', opportunity_id: oppId, notes: `Reply: ${p.category} | ${p.summary}`, last_contact_date: new Date() });
          await Opportunity.findOneAndUpdate({ opportunity_id: oppId }, { lead_id: lead.lead_id, service: p.recommended_service, stage: p.category, bdm: lead.bdm_owner, discovery_date: new Date() }, { upsert: true });
          axios.post('https://vynoravinay.app.n8n.cloud/webhook/vynora/proposal-intake', { opportunity_id: oppId, lead_id: lead.lead_id, email: from, summary: p.summary }).catch(() => {});
          
          // AI AUTO-DRAFTING (Second AI Call)
          const draftSys = 'You are a senior sales closer for VYNORA. Write a polite, professional, and highly concise reply addressing the prospect\'s exact email. Suggest a brief 10-minute introductory call. End with a simple signature. Do not use placeholders. Return ONLY JSON: { "subject": "Re: ...", "body": "..." }';
          const draftAi = await aiGatewayService.processAiRequest({ prompt: `Prospect: ${contact.name}\nReceived Email: ${body}\nContext: ${p.summary}`, system_prompt: draftSys, temperature: 0.5, max_tokens: 300 });
          if (draftAi.success) {
            try {
              const parsed = JSON.parse(draftAi.text.replace(/^\s*```json\s*/i,'').replace(/```\s*$/,'').trim());
              await Message.create({ 
                message_id: `MSG-DRAFT-${Date.now()}`, 
                conversation_id: convId, 
                lead_id: lead.lead_id, 
                contact_id: contact.contact_id, 
                opportunity_id: oppId, 
                channel: 'email', 
                direction: 'outbound', 
                subject: parsed.subject || `Re: ${subject}`, 
                body: parsed.body || draftAi.text, 
                purpose: 'ai_draft_reply', 
                status: 'draft' 
              });
              await Log.create({ execution_id: exec_id, workflow: wf, entity_id: lead.lead_id, action: `AI Auto-Drafted reply for ${contact.name}`, result: 'Drafted', severity: 'Low' } as any);
            } catch(e) { console.error('Failed to parse AI draft', e); }
          }
        } 
        else if (bucket === 'negative') {
          await Lead.updateOne({ lead_id: lead.lead_id }, { qualification_status: p.category, stage: 'Closed Lost', status: 'closed', notes: `Reply: ${p.category} | ${p.summary}`, last_contact_date: new Date() });
          if (p.unsubscribe || p.category === 'Unsubscribe') await Contact.updateOne({ contact_id: contact.contact_id }, { opt_out: true, email_status: 'unsubscribed' });
        }

        await Conversation.findOneAndUpdate({ conversation_id: convId }, { lead_id: lead.lead_id, contact_id: contact.contact_id, opportunity_id: oppId, intent: p.intent, buying_signals: p.category, stage: bucket, last_message_at: new Date() }, { upsert: true });
        await Message.create({ message_id: `MSG-${messageId}`, conversation_id: convId, lead_id: lead.lead_id, contact_id: contact.contact_id, opportunity_id: oppId, channel: 'email', direction: 'inbound', subject, body, purpose: 'reply', status: 'received', idempotency_key: messageId, provider_message_id: messageId, sent_at: new Date() });
        await Log.create({ execution_id: exec_id, workflow: wf, entity_id: lead.lead_id, action: `Reply classified ${p.category}`, result: bucket, severity: 'Low' });
        await connection.addFlags(item.attributes.uid, ['\\Seen']);
      }
    } catch (e: any) { console.error('IMAP Error:', e.message); }
    finally { if (connection) connection.end(); }
  }
};
