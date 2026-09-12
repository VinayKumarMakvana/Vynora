import { Router } from 'express';
import { handleFinanceWebhook } from '../controllers/finance.controller';

const router = Router();

router.post('/finance', handleFinanceWebhook);

export default router;
