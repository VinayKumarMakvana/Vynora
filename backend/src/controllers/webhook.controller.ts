import { Request, Response } from 'express';
import Stripe from 'stripe';
import crypto from 'crypto';
import { Payment } from '../models/Payment';
import { Opportunity } from '../models/Opportunity';
import { Lead } from '../models/Lead';
import { Meeting } from '../models/Meeting';
import { Log } from '../models/Log';

// Initialize Stripe (will use dummy/placeholder key if not set)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2025-01-27.acacia' as any
});

/**
 * Handle Stripe Webhooks
 * Expects express.raw({ type: 'application/json' }) middleware before this route
 */
export const handleStripeWebhook = async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;

  try {
    // req.body should be a Buffer because of express.raw()
    event = stripe.webhooks.constructEvent(req.body, sig as string, endpointSecret as string);
  } catch (err: any) {
    console.error(`[Webhook] Stripe signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const exec_id = `exec-wh-${Date.now()}`;
  const workflow = 'VYNORA-W20-Payment-Webhook';

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        
        // We expect client_reference_id to contain the opportunity_id or lead_id
        const oppId = session.client_reference_id || 'UNKNOWN';
        const amount = (session.amount_total || 0) / 100; // Convert cents to dollars
        const currency = (session.currency || 'usd').toUpperCase();
        
        // 1. Create Payment Record
        const paymentId = `PAY-${session.id}`;
        await Payment.findOneAndUpdate(
          { payment_id: paymentId },
          {
            payment_id: paymentId,
            event_id: event.id,
            opportunity_id: oppId,
            event_type: 'stripe.checkout',
            amount: amount,
            currency: currency,
            status: 'completed',
            provider: 'stripe'
          },
          { upsert: true }
        );

        // 2. Update Opportunity to "Closed Won"
        if (oppId.startsWith('OPP-')) {
          await Opportunity.findOneAndUpdate(
            { opportunity_id: oppId },
            { 
              stage: 'Closed Won', 
              close_date: new Date(), 
              actual_revenue: amount 
            }
          );
        }

        await Log.create({
          execution_id: exec_id,
          workflow,
          entity_id: oppId,
          action: 'Stripe Payment Received',
          result: `Paid $${amount}`,
          severity: 'Low',
          human_approval: false
        } as any);

        break;
      }
      // Handle other event types if needed (e.g., payment_intent.succeeded)
      default:
        console.log(`[Webhook] Unhandled Stripe event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error(`[Webhook] Error processing Stripe event: ${error.message}`);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * Handle Calendly Webhooks
 */
export const handleCalendlyWebhook = async (req: Request, res: Response) => {
  const exec_id = `exec-wh-${Date.now()}`;
  const workflow = 'VYNORA-W21-Meeting-Webhook';
  
  try {
    const payload = req.body;
    
    // In a real scenario, you verify the Calendly webhook signature here.
    // Calendly sends 'Calendly-Webhook-Signature' header.
    // For now, we trust the payload if it matches the expected structure.
    
    if (payload.event === 'invitee.created') {
      const invitee = payload.payload;
      const email = invitee.email?.toLowerCase();
      
      if (!email) {
        return res.status(400).json({ error: 'No email found in Calendly payload' });
      }

      // 1. Find Lead by Contact Email
      const lead = await Lead.aggregate([
        {
          $lookup: {
            from: 'contacts',
            localField: 'contact_id',
            foreignField: 'contact_id',
            as: 'contact'
          }
        },
        { $unwind: '$contact' },
        { $match: { 'contact.email': email } }
      ]).then(res => res[0]);

      if (lead) {
        const meetingId = `MTG-CAL-${Date.now()}`;
        const oppId = lead.opportunity_id || `OPP-${lead.lead_id}`;

        // 2. Create Meeting Record
        await Meeting.create({
          meeting_id: meetingId,
          opportunity_id: oppId,
          lead_id: lead.lead_id,
          contact_id: lead.contact_id,
          company_id: lead.company_id,
          channel: 'video', // default assuming calendly zoom/meet
          scheduled_at: new Date(invitee.scheduled_event.start_time),
          status: 'Scheduled',
          source: 'Calendly'
        });

        // 3. Advance Pipeline Stage
        await Opportunity.findOneAndUpdate(
          { opportunity_id: oppId },
          { stage: 'Meeting Scheduled' },
          { upsert: true }
        );

        await Lead.findOneAndUpdate(
          { lead_id: lead.lead_id },
          { stage: 'Engaged', opportunity_id: oppId }
        );

        await Log.create({
          execution_id: exec_id,
          workflow,
          entity_id: lead.lead_id,
          action: 'Meeting Booked via Calendly',
          result: `Scheduled for ${invitee.scheduled_event.start_time}`,
          severity: 'Low',
          human_approval: false
        } as any);
      } else {
        console.warn(`[Webhook] Calendly meeting booked but email ${email} not found in CRM.`);
      }
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error(`[Webhook] Error processing Calendly event: ${error.message}`);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
