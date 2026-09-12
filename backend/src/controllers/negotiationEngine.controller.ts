import { Request, Response } from 'express';
import { negotiationEngineService } from '../services/negotiationEngine.service';

export const handleNegotiation = async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    const result = await negotiationEngineService.processRequest(payload);
    
    if (result && (result as any).status === 'error') {
      const code = (result as any).reason === 'missing_context' || (result as any).reason === 'approval_not_found' ? 404 : 400;
      return res.status(code).json(result);
    }
    
    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Error in negotiation webhook:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error', error: error.message });
  }
};
