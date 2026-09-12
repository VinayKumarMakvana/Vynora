import { Router } from 'express';
import { handleMeetingWebhook } from '../controllers/meeting.controller';

const router = Router();

router.post('/schedule-meeting', handleMeetingWebhook);

export default router;
