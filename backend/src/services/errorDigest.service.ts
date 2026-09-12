import { Log } from '../models/Log';
import nodemailer from 'nodemailer';

export class ErrorDigestService {
  private async sendEmail(to: string, subject: string, text: string) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
      });
      await transporter.sendMail({ from: process.env.GMAIL_USER, to, subject, text });
      return true;
    } catch (e: any) {
      console.error('Email send failed:', e.message);
      return false;
    }
  }

  async runDailyDigest() {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const rows = await Log.find({
        severity: 'High',
        log_time: { $gte: twentyFourHoursAgo }
      }).sort({ log_time: 1 }) as any[];

      const count = rows.length;
      const today = new Date().toISOString().slice(0, 10);

      let bodyLines: string[] = [];
      if (count === 0) {
        bodyLines.push('No High-severity errors were logged in the last 24 hours.');
        bodyLines.push('');
        bodyLines.push('The VYNORA engine (W04/W05/W06/W08) ran clean.');
      } else {
        bodyLines.push(`High-severity errors logged in the last 24 hours: ${count}`);
        bodyLines.push('');
        for (const r of rows) {
          const wf = r.workflow || 'Unknown workflow';
          const ex = r.execution_id || '';
          const err = (r.error || 'No detail').toString();
          const clipped = err.length > 200 ? err.slice(0, 200) + '…' : err;
          bodyLines.push(`• [${wf}] exec ${ex} — ${clipped}`);
        }
        bodyLines.push('');
        bodyLines.push('Full detail is in the vynora_logs table (severity = High).');
      }

      const subject = count === 0
        ? `VYNORA Daily Error Digest — ${today} — All clear (0)`
        : `VYNORA Daily Error Digest — ${today} — ${count} High-severity error(s)`;

      const alertEmail = process.env.ALERT_EMAIL;
      if (!alertEmail) {
        throw new Error('ALERT_EMAIL is not defined in .env');
      }
      const sent = await this.sendEmail(alertEmail, subject, bodyLines.join('\n'));
      
      console.log(`Daily error digest generated (count: ${count}), email sent to ${alertEmail}: ${sent}`);
      return { success: true, count };
    } catch (error) {
      console.error('Error generating daily error digest:', error);
      return { success: false, error };
    }
  }
}

export const errorDigestService = new ErrorDigestService();
