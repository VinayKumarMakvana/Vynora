import { Router } from 'express';
import { handleWorkflowError } from '../controllers/errorAlert.controller';

const router = Router();

router.post('/error-alert', handleWorkflowError);

export default router;
