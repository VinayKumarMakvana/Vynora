import { Log } from '../models/Log';
import nodemailer from 'nodemailer';

export class ErrorAlertService {
  private async sendAlertEmail(subject: string, text: string) {
    const reportEmail = process.env.REPORT_EMAIL;
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_PASS;

    if (!reportEmail || !gmailUser || !gmailPass) {
      console.warn('Alert Email Skipped: REPORT_EMAIL, GMAIL_USER, or GMAIL_PASS missing from environment variables.');
      return false;
    }

    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass }
      });
      await transporter.sendMail({ from: gmailUser, to: reportEmail, subject, text });
      return true;
    } catch (e) {
      console.error('Failed to send error alert email:', e);
      return false;
    }
  }

  async logWorkflowError(body: any) {
    const s = (v: any) => (v === undefined || v === null) ? '' : String(v).trim();
    
    const wf = body.workflow || {};
    const ex = body.execution || {};
    const err = ex.error || body.error || {};
    const errNode = err.node || {};

    const workflow_name = s(wf.name) || 'Unknown workflow';
    const workflow_id = s(wf.id);
    const execution_id = s(ex.id) || s(body.id) || `exec-err-${Date.now()}`;
    const execution_url = s(ex.url);

    const failing_node = s(errNode.name) || s(ex.lastNodeExecuted) || 'Unknown node';

    let error_message = s(err.message) || s(err.description) || 'No error message provided';
    if (error_message.length > 800) error_message = error_message.slice(0, 800) + '…';

    const when = new Date();

    const newLog = await Log.create({
      execution_id: execution_id,
      workflow: workflow_name,
      entity_id: workflow_id || 'unknown_entity',
      action: 'workflow_error',
      result: 'Failed',
      error: `Node: ${failing_node} | ${error_message}`,
      severity: 'High',
      human_approval: false,
      event_id: execution_id,
      log_time: when
    } as any);

    // SEND IMMEDIATE ALERT EMAIL
    const subject = `[VYNORA EMERGENCY ALERT] Workflow Error: ${workflow_name}`;
    const text = `VYNORA SYSTEM ALERT\n\nAn error occurred in a background workflow.\n\nTime: ${when.toISOString()}\nWorkflow: ${workflow_name}\nExecution ID: ${execution_id}\nFailing Node: ${failing_node}\n\nError Message:\n${error_message}\n\nPlease check the Render or Vercel logs immediately to prevent pipeline blockages.`;
    
    await this.sendAlertEmail(subject, text);

    return {
      status: 'success',
      message: 'Error logged and alert sent successfully',
      log_id: newLog._id
    };
  }
}
