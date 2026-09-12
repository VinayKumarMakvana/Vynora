import { Request, Response } from 'express';
import { MeetingService } from '../services/meeting.service';

const meetingService = new MeetingService();

export const handleMeetingWebhook = async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const result = await meetingService.handleMeetingWebhook(body);
    
    // The service returns objects with `status` and `reason`/`error`. 
    // Usually a 200, but we return 400 for invalid, 404 for missing context.
    let statusCode = 200;
    if (result?.status === 'error') {
      if (result.reason === 'missing_context' || result.reason === 'meeting_not_found') statusCode = 404;
      else if (result.reason === 'send_failed') statusCode = 502;
      else statusCode = 400;
    } else if (result?.status === 'confirmed_no_email') {
      statusCode = 502;
    }

    return res.status(statusCode).json(result);
  } catch (error: any) {
    console.error('Error in meeting webhook:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error', error: error.message });
  }
};
