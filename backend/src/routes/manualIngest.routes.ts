import { Router } from 'express';
import { handleIngestLead } from '../controllers/manualIngest.controller';

const router = Router();

router.post('/ingest-lead', handleIngestLead);

export default router;
