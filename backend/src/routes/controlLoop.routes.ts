import { Router } from 'express';
import { handleControlLoopRun } from '../controllers/controlLoop.controller';

const router = Router();

router.post('/control/run', handleControlLoopRun);

export default router;
