import { Router } from 'express';
import { handleAnalyticsRun } from '../controllers/analyticsEngine.controller';

const router = Router();

router.post('/analytics/run', handleAnalyticsRun);

export default router;
