import { Request, Response } from 'express';
import { ProposalService } from '../services/proposal.service';

const proposalService = new ProposalService();

export const handleProposalIntake = async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const result = await proposalService.handleProposalIntake(body);
    
    let statusCode = 200;
    if (result?.status === 'error') {
      if (result.reason === 'missing_context') statusCode = 404;
      else statusCode = 400;
    } else if (result?.status === 'send_failed') {
      statusCode = 502;
    }

    return res.status(statusCode).json(result);
  } catch (error: any) {
    console.error('Error in proposal webhook:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error', error: error.message });
  }
};
