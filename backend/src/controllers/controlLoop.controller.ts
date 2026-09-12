import { Request, Response } from 'express';
import { controlLoopService } from '../services/controlLoop.service';

export const handleControlLoopRun = async (req: Request, res: Response) => {
  try {
    const isManual = req.body.manual !== false;
    const result = await controlLoopService.runCycle(isManual);
    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Error running control loop:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error', error: error.message });
  }
};
