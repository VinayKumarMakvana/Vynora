import { Router } from 'express';
import { scopingController } from '../controllers/scoping.controller';

const router = Router();
router.post('/scoping/meeting-scope', scopingController.handleMeetingScope);

export default router;
