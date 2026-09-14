import { Request, Response } from 'express';
import { Lead } from '../models/Lead';
import { Log } from '../models/Log';
import { Config } from '../models/Config';
import { Opportunity } from '../models/Opportunity';
import { Payment } from '../models/Payment';
import { Message } from '../models/Message';
import { Meeting } from '../models/Meeting';
import { Contact } from '../models/Contact';
import { Company } from '../models/Company';
import { Conversation } from '../models/Conversation';

// ── NOTIFICATIONS ────────────────────────────────────────────────
export const getNotifications = async (req: Request, res: Response) => {
  try {
    const logs = await Log.find({
      severity: { $in: ['HIGH', 'MEDIUM', 'ERROR', 'WARNING', 'SUCCESS', 'INFO'] }
    }).sort({ log_time: -1, createdAt: -1 }).limit(20);

    const notifications = logs.map((log: any) => ({
      id: log._id.toString(),
      title: log.action || log.workflow || 'System Event',
      message: log.message || log.result || 'No details available',
      severity: log.severity || 'INFO',
      time: log.log_time || log.createdAt,
      workflow: log.workflow || '',
      read: false
    }));

    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
};

// ── DASHBOARD STATS ──────────────────────────────────────────────
export const getStats = async (req: Request, res: Response) => {
  try {
    const totalLeads = await Lead.countDocuments();
    // Case-insensitive match via $in array is much faster than regex if properly indexed
    const verifiedLeads = await Lead.countDocuments({ 
      qualification_status: { $in: ['Qualified', 'qualified'] },
      outreach_eligible: true
    });
    const outboundSent = await Message.countDocuments({ direction: 'outbound', status: 'sent' });
    const repliesCount = await Message.countDocuments({ direction: 'inbound' });
    const payments = await Payment.find({ status: { $regex: /paid/i } });
    const revenue = payments.reduce((acc, curr) => acc + (curr.amount || 0), 0);
    const pendingRevenue = (await Payment.find({ status: { $regex: /pending|requested|held/i } })).reduce((a, c) => a + (c.amount || 0), 0);

    // Verify rate
    const verifyRate = totalLeads > 0 ? Math.round((verifiedLeads / totalLeads) * 100) : 0;

    // Daily email cap from config
    const capConfig = await Config.findOne({ config_key: 'daily_email_cap', is_active: true });
    const dailyCap = Number(capConfig?.config_value) || 25;

    // Emails sent today
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const sentToday = await Message.countDocuments({ direction: 'outbound', createdAt: { $gte: todayStart } });

    res.json({
      leadsSourced: totalLeads,
      verifiedLeads,
      verifyRate,
      outboundSent,
      replies: repliesCount,
      revenue,
      pendingRevenue,
      sentToday,
      dailyCap
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
};

// ── LIVE FEED ────────────────────────────────────────────────────
export const getFeed = async (req: Request, res: Response) => {
  try {
    const logs = await Log.find().sort({ log_time: -1, createdAt: -1 }).limit(50);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
};

// ── LEADS ────────────────────────────────────────────────────────
export const getLeads = async (req: Request, res: Response) => {
  try {
    const leads = await Lead.aggregate([
      { $sort: { createdAt: -1 } },
      { $limit: 200 },
      {
        $lookup: {
          from: 'contacts',
          localField: 'contact_id',
          foreignField: 'contact_id',
          as: 'contact'
        }
      },
      {
        $lookup: {
          from: 'leadscores',
          localField: 'lead_id',
          foreignField: 'lead_id',
          as: 'score'
        }
      },
      {
        $addFields: {
          email: { $arrayElemAt: ['$contact.email', 0] },
          mx: { $eq: [{ $arrayElemAt: ['$contact.email_status', 0] }, 'verified'] },
          score: { $arrayElemAt: ['$score.fit_score', 0] },
          priority: { $arrayElemAt: ['$score.priority', 0] }
        }
      },
      {
        $project: {
          contact: 0,
          'score.fit_score': 0,
          'score.priority': 0
        }
      }
    ]);
    res.json(leads);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
};

// ── PIPELINE ─────────────────────────────────────────────────────
export const getPipeline = async (req: Request, res: Response) => {
  try {
    const opportunities = await Opportunity.find().sort({ updatedAt: -1 });
    res.json(opportunities);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pipeline' });
  }
};

// ── CONFIG ───────────────────────────────────────────────────────
export const getConfig = async (req: Request, res: Response) => {
  try {
    const configs = await Config.find();
    res.json(configs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch configs' });
  }
};

export const updateConfig = async (req: Request, res: Response) => {
  try {
    const { key, value } = req.body;
    await Config.findOneAndUpdate(
      { config_key: key },
      { config_value: value },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update config' });
  }
};

// ── OUTREACH ─────────────────────────────────────────────────────
export const getOutreachQueue = async (req: Request, res: Response) => {
  try {
    const queueLeads = await Lead.aggregate([
      { 
        $match: { 
          qualification_status: { $in: ['Qualified', 'qualified'] },
          outreach_eligible: true 
        } 
      },
      { $sort: { createdAt: -1 } },
      { $limit: 50 },
      {
        $lookup: {
          from: 'contacts',
          localField: 'contact_id',
          foreignField: 'contact_id',
          as: 'contact'
        }
      },
      {
        $lookup: {
          from: 'leadscores',
          localField: 'lead_id',
          foreignField: 'lead_id',
          as: 'scoreDoc'
        }
      },
      {
        $addFields: {
          email: { $arrayElemAt: ['$contact.email', 0] },
          fit_score: { $arrayElemAt: ['$scoreDoc.fit_score', 0] },
        }
      },
      {
        $project: {
          contact: 0,
          scoreDoc: 0
        }
      }
    ]);

    res.json(queueLeads);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch outreach queue' });
  }
};

export const purgeOutreachQueue = async (req: Request, res: Response) => {
  try {
    await Lead.updateMany(
      { qualification_status: { $in: ['Qualified', 'qualified'] }, outreach_eligible: true },
      { $set: { outreach_eligible: false, status: 'purged' } }
    );
    res.json({ success: true, message: 'Queue purged' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to purge queue' });
  }
};

export const getInboxMessages = async (req: Request, res: Response) => {
  try {
    const inbound = await Message.find({ direction: 'inbound' })
      .sort({ createdAt: -1 }).limit(50);
    res.json(inbound);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch inbox' });
  }
};

// ── FINANCE ──────────────────────────────────────────────────────
export const getFinance = async (req: Request, res: Response) => {
  try {
    const payments = await Payment.find().sort({ createdAt: -1 }).limit(100);
    const completed = payments.filter(p => /paid/i.test(p.status));
    const pending = payments.filter(p => /pending|requested|held/i.test(p.status));
    const totalRevenue = completed.reduce((a, c) => a + (c.amount || 0), 0);
    const pendingRevenue = pending.reduce((a, c) => a + (c.amount || 0), 0);
    const netMargin = totalRevenue > 0 ? 100 : 0;
    res.json({ totalRevenue, pendingRevenue, netMargin, payments });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch finance data' });
  }
};

// ── SHIFT STATS ──────────────────────────────────────────────────
export const getShiftStats = async (req: Request, res: Response) => {
  try {
    const capConfig = await Config.findOne({ config_key: 'outbound_day_limit', is_active: true });
    const dayLimit = Number(capConfig?.config_value) || 75;
    const shiftLimit = Math.ceil(dayLimit / 3);
    const SHIFT_HOURS = 8;
    const now = new Date();
    const istNow = new Date(now.getTime() + (330 * 60000));
    const currentShiftIdx = Math.floor(istNow.getUTCHours() / SHIFT_HOURS);
    const shiftStartUTC = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), currentShiftIdx * SHIFT_HOURS, 0, 0, 0) - (330 * 60000));
    const nextShiftStartIST = new Date(istNow);
    nextShiftStartIST.setUTCHours((currentShiftIdx + 1) * SHIFT_HOURS - (330 / 60));
    nextShiftStartIST.setUTCMinutes(0); nextShiftStartIST.setUTCSeconds(0);
    const msToNextShift = nextShiftStartIST.getTime() - now.getTime();
    const sentThisShift = await Message.countDocuments({ direction: 'outbound', status: 'sent', sent_at: { $gte: shiftStartUTC } });
    res.json({ shiftLimit, sentThisShift, remainingShift: Math.max(0, shiftLimit - sentThisShift), dayLimit, msToNextShift, currentShiftIdx });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch shift stats' });
  }
};

// ── AI DRAFT REPLIES ─────────────────────────────────────────────
export const getDraftReplies = async (req: Request, res: Response) => {
  try {
    const drafts = await Message.find({ purpose: 'ai_draft_reply', status: 'draft' }).sort({ createdAt: -1 }).limit(20);
    res.json(drafts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch draft replies' });
  }
};

export const sendDraftReply = async (req: Request, res: Response) => {
  try {
    const { message_id, body, subject } = req.body;
    const draft = await Message.findOne({ message_id, status: 'draft' });
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    const contact = await Contact.findOne({ contact_id: draft.contact_id });
    if (!contact?.email) return res.status(400).json({ error: 'No email on contact' });
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS } });
    await transporter.sendMail({ from: process.env.GMAIL_USER, to: contact.email, subject: subject || draft.subject || 'Re: Your enquiry', text: body || draft.body });
    await Message.updateOne({ message_id }, { $set: { status: 'sent', sent_at: new Date(), body: body || draft.body } });
    await Log.create({ execution_id: `exec-${Date.now()}`, workflow: 'VYNORA-W02-Inbound-Reply-Handler', entity_id: draft.lead_id, action: 'Draft reply sent by admin', result: 'Sent', severity: 'Low', human_approval: true });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
