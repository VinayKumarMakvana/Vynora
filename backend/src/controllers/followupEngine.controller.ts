import { Request, Response } from 'express';
import { followupEngineService } from '../services/followupEngine.service';

export const handleManualFollowups = async (req: Request, res: Response) => {
  try {
    const result = await followupEngineService.runFollowups();
    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Error in manual followups:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error', error: error.message });
  }
};
