import { Router } from 'express';
import { handleShiftReportRun } from '../controllers/shiftReport.controller';

const router = Router();

router.post('/report/shift', handleShiftReportRun);

export default router;
