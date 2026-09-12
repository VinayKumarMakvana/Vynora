import { Request, Response } from 'express';
import { leadSourcingService } from '../services/leadSourcing.service';

export const handleManualSourcing = async (req: Request, res: Response) => {
  try {
    const result = await leadSourcingService.runSourcing();
    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Error in manual sourcing:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error', error: error.message });
  }
};
