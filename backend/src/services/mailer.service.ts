import * as nodemailer from 'nodemailer';

export class MailerService {
  private transporter: nodemailer.Transporter | null = null;

  private getTransporter() {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_PASS
        }
      });
    }
    return this.transporter;
  }

  async sendEmail(to: string, subject: string, text: string, html?: string) {
    try {
      const transporter = this.getTransporter();
      const mailOptions: nodemailer.SendMailOptions = {
        from: process.env.GMAIL_USER,
        to,
        subject
      };
      
      if (html) {
        mailOptions.html = html;
      } else {
        mailOptions.text = text;
      }
      
      const info = await transporter.sendMail(mailOptions);
      return { success: true, messageId: info.messageId };
    } catch (error: any) {
      console.error('[MailerService] Failed to send email:', error.message);
      return { success: false, error: error.message };
    }
  }
}

export const mailerService = new MailerService();
