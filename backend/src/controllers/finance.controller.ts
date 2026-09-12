import { Request, Response } from 'express';
import { FinanceService } from '../services/finance.service';

const financeService = new FinanceService();

export const handleFinanceWebhook = async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    let action = String(body.action || '').toLowerCase();
    const valid = ['payment_request', 'payment_event', 'handoff_decision'];

    if (!valid.includes(action)) {
      action = 'invalid';
    }

    let result;
    if (action === 'payment_request') {
      result = await financeService.handlePaymentRequest(body);
    } else if (action === 'payment_event') {
      result = await financeService.handlePaymentEvent(body);
    } else if (action === 'handoff_decision') {
      result = await financeService.handleHandoffDecision(body);
    } else {
      // invalid
      return res.status(400).json({ success: false, message: 'Invalid action' });
    }

    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Error in finance webhook:', error);
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};
