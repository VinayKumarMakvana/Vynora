import { Router } from 'express';
import { handleCloseDeal } from '../controllers/closingEngine.controller';

const router = Router();

router.post('/close-deal', handleCloseDeal);

export default router;
