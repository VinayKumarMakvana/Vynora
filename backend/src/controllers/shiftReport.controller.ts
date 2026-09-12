import { Request, Response } from 'express';
import { shiftReportService } from '../services/shiftReport.service';

export const handleShiftReportRun = async (req: Request, res: Response) => {
  try {
    const result = await shiftReportService.runReport();
    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Error running shift report:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error', error: error.message });
  }
};
