import { Router } from 'express';
import { 
  getStats, 
  getFeed, 
  getLeads, 
  getPipeline, 
  getConfig, 
  updateConfig,
  getNotifications,
  getOutreachQueue,
  purgeOutreachQueue,
  getInboxMessages,
  getFinance,
  getShiftStats,
  getDraftReplies,
  sendDraftReply
} from '../controllers/dashboard.controller';

const router = Router();

router.get('/stats', getStats);
router.get('/feed', getFeed);
router.get('/leads', getLeads);
router.get('/pipeline', getPipeline);
router.get('/config', getConfig);
router.post('/config', updateConfig);
router.get('/notifications', getNotifications);
router.get('/outreach/queue', getOutreachQueue);
router.delete('/outreach/queue', purgeOutreachQueue);
router.get('/outreach/inbox', getInboxMessages);
router.get('/outreach/drafts', getDraftReplies);
router.post('/outreach/drafts/send', sendDraftReply);
router.get('/shift/stats', getShiftStats);
router.get('/finance', getFinance);

export default router;
