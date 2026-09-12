import { Request, Response } from 'express';
import { aiGatewayService, AiGatewayPayload } from '../services/aiGateway.service';

export const aiGatewayController = {
  async handleRequest(req: Request, res: Response) {
    try {
      const payload: AiGatewayPayload = req.body;
      const result = await aiGatewayService.processAiRequest(payload);
      
      // We always return 200 OK with the result object as per n8n pattern (unless server crashes)
      res.json(result);
    } catch (error: any) {
      console.error('Error in AI Gateway Controller:', error);
      res.status(500).json({ 
        success: false, 
        text: '', 
        error: error.message || 'Internal Server Error' 
      });
    }
  }
};
