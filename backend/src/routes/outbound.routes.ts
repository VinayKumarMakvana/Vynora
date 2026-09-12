import { Router } from 'express';
import { outboundController } from '../controllers/outbound.controller';

const router = Router();
router.post('/outbound/run', outboundController.runManual);

export default router;
