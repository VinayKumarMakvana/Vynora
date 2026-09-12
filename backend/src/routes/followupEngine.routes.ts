import { Router } from 'express';
import { handleManualFollowups } from '../controllers/followupEngine.controller';

const router = Router();

router.post('/followup-run', handleManualFollowups);

export default router;
