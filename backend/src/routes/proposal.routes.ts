import { Router } from 'express';
import { handleProposalIntake } from '../controllers/proposal.controller';

const router = Router();

router.post('/proposal-intake', handleProposalIntake);

export default router;
