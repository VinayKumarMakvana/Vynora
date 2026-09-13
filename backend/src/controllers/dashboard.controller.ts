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
    // Case-insensitive match: DB stores 'Qualified' (capital Q)
    const verifiedLeads = await Lead.countDocuments({ 
      qualification_status: { $regex: /^qualified$/i },
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
          qualification_status: { $regex: /^qualified$/i },
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
      { qualification_status: { $regex: /^qualified$/i }, outreach_eligible: true },
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

    // Net profit margin: all revenue is net (no COGS for AI agency)
    const netMargin = totalRevenue > 0 ? 100 : 0;

    res.json({
      totalRevenue,
      pendingRevenue,
      netMargin,
      payments
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch finance data' });
  }
};
