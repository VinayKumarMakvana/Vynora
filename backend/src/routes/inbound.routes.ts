import { Router } from 'express';
import { inboundController } from '../controllers/inbound.controller';

const router = Router();
router.post('/inbound/poll', inboundController.pollManual);

export default router;
