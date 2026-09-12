import { Request, Response } from 'express';
import { closingEngineService } from '../services/closingEngine.service';

export const handleCloseDeal = async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    const result = await closingEngineService.processCloseDeal(payload);
    
    if (result && (result as any).status === 'error') {
      const code = (result as any).reason === 'missing_context' ? 404 : ((result as any).reason === 'invalid' ? 422 : 400);
      return res.status(code).json(result);
    }
    
    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Error in close-deal webhook:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error', error: error.message });
  }
};
