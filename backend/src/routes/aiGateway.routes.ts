import { Router } from 'express';
import { aiGatewayController } from '../controllers/aiGateway.controller';

const router = Router();

router.post('/ai-gateway', aiGatewayController.handleRequest);

export default router;
