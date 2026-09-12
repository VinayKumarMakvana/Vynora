import { Request, Response } from 'express';
import { inboundHandlerService } from '../services/inboundHandler.service';

export const inboundController = {
  async pollManual(req: Request, res: Response) {
    try {
      await inboundHandlerService.pollUnreadEmails();
      res.json({ success: true, message: 'Poll triggered' });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
};
