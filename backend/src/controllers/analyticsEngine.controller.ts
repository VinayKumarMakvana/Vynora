import { Request, Response } from 'express';
import { analyticsEngineService } from '../services/analyticsEngine.service';

export const handleAnalyticsRun = async (req: Request, res: Response) => {
  try {
    const result = await analyticsEngineService.runAnalytics();
    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Error running analytics engine:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error', error: error.message });
  }
};
