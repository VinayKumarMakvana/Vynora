import { Request, Response } from 'express';
import { ManualIngestService } from '../services/manualIngest.service';

const manualIngestService = new ManualIngestService();

export const handleIngestLead = async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const result = await manualIngestService.handleIngest(body);
    
    let statusCode = 200;
    if (result?.status === 'error') statusCode = 400;

    return res.status(statusCode).json(result);
  } catch (error: any) {
    console.error('Error in manual ingest:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error', error: error.message });
  }
};
