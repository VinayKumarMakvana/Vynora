import { Router } from 'express';
import { handleNegotiation } from '../controllers/negotiationEngine.controller';

const router = Router();

router.post('/negotiate', handleNegotiation);

export default router;
