import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import cron from 'node-cron';
import aiGatewayRoutes from './routes/aiGateway.routes';
import outboundRoutes from './routes/outbound.routes';
import inboundRoutes from './routes/inbound.routes';
import scopingRoutes from './routes/scoping.routes';
import financeRoutes from './routes/finance.routes';
import meetingRoutes from './routes/meeting.routes';
import proposalRoutes from './routes/proposal.routes';
import errorAlertRoutes from './routes/errorAlert.routes';
import manualIngestRoutes from './routes/manualIngest.routes';
import leadSourcingRoutes from './routes/leadSourcing.routes';
import followupEngineRoutes from './routes/followupEngine.routes';
import negotiationEngineRoutes from './routes/negotiationEngine.routes';
import closingEngineRoutes from './routes/closingEngine.routes';
import analyticsEngineRoutes from './routes/analyticsEngine.routes';
import controlLoopRoutes from './routes/controlLoop.routes';
import shiftReportRoutes from './routes/shiftReport.routes';
import dashboardRoutes from './routes/dashboard.routes';
import webhookRoutes from './routes/webhook.routes';
import { connectDB } from './config/db';
import { outboundMachineService } from './services/outboundMachine.service';
import { inboundHandlerService } from './services/inboundHandler.service';
import { MeetingService } from './services/meeting.service';
import { errorDigestService } from './services/errorDigest.service';
import { leadSourcingService } from './services/leadSourcing.service';
import { followupEngineService } from './services/followupEngine.service';
import { analyticsEngineService } from './services/analyticsEngine.service';
import { controlLoopService } from './services/controlLoop.service';
import { shiftReportService } from './services/shiftReport.service';
import { shiftOrchestratorService } from './services/shiftOrchestrator.service';

// Load environment variables
dotenv.config();

// Connect to MongoDB
connectDB();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware - Webhooks must be mounted BEFORE global express.json() because Stripe needs raw body
app.use('/api/webhooks', webhookRoutes);

app.use(cors());
app.use(express.json());

// Routes
app.use('/api', aiGatewayRoutes);
app.use('/api', outboundRoutes);
app.use('/api', inboundRoutes);
app.use('/api', scopingRoutes);
app.use('/api/vynora', financeRoutes);
app.use('/api/vynora', meetingRoutes);
app.use('/api/vynora', proposalRoutes);
app.use('/api/vynora', errorAlertRoutes);
app.use('/api/vynora', manualIngestRoutes);
app.use('/api/vynora', leadSourcingRoutes);
app.use('/api/vynora', followupEngineRoutes);
app.use('/api/vynora', negotiationEngineRoutes);
app.use('/api/vynora', closingEngineRoutes);
app.use('/api/vynora', analyticsEngineRoutes);
app.use('/api/vynora', controlLoopRoutes);
app.use('/api/vynora', shiftReportRoutes);
app.use('/api/vynora/dashboard', dashboardRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

app.get('/api/vynora/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

// Outbound logic is now handled in the Shift Orchestrator
cron.schedule('* * * * *', async () => {
  await inboundHandlerService.pollUnreadEmails();
});

cron.schedule('0 * * * *', async () => {
  console.log('Running hourly Meeting Reminder Sweep');
  const meetingService = new MeetingService();
  await meetingService.handleReminderSweep();
});

cron.schedule('0 8 * * *', async () => {
  console.log('Running daily Error Digest');
  await errorDigestService.runDailyDigest();
});

cron.schedule('0 */4 * * *', async () => {
  console.log('Running 4-hourly Lead Sourcing via OSM');
  await leadSourcingService.runSourcing();
});

cron.schedule('0 * * * *', async () => {
  console.log('Running hourly Follow-up Engine');
  await followupEngineService.runFollowups();
});

// Unified 8-Hour Shift Orchestrator

cron.schedule('0 */8 * * *', async () => {
  console.log('Starting Unified 8-Hour AI Shift...');
  try {
    await shiftOrchestratorService.runShift();
  } catch (err) {
    console.error('Error in Shift Orchestrator:', err);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
