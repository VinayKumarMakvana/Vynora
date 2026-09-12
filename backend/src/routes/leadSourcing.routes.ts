import { Router } from 'express';
import { handleManualSourcing } from '../controllers/leadSourcing.controller';

const router = Router();

router.post('/sourcing-run', handleManualSourcing);

export default router;
