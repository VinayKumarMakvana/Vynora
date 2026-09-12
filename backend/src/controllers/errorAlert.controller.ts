import { Request, Response } from 'express';
import { ErrorAlertService } from '../services/errorAlert.service';

const errorAlertService = new ErrorAlertService();

export const handleWorkflowError = async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const result = await errorAlertService.logWorkflowError(body);
    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Error in workflow error alert:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error', error: error.message });
  }
};
