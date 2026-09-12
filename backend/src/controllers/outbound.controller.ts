import { Request, Response } from 'express';
import { outboundMachineService } from '../services/outboundMachine.service';

export const outboundController = {
  async runManual(req: Request, res: Response) {
    try {
      const result = await outboundMachineService.runMachine('manual-api');
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
};
