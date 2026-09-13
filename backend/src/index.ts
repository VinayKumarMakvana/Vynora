import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import cron from 'node-cron';
import rateLimit from 'express-rate-limit';
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

// Rate Limiting (Anti-DDOS for AI/Webhooks)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // limit each IP to 500 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(cors());
// Parse JSON with a strict 10MB limit to prevent Heap Out of Memory crashes
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Apply rate limiter to all API routes
app.use('/api', apiLimiter);

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
  try {
    await inboundHandlerService.pollUnreadEmails();
  } catch (e) {
    console.error('Fatal error in pollUnreadEmails cron:', e);
  }
});

cron.schedule('0 * * * *', async () => {
  console.log('Running hourly Meeting Reminder Sweep');
  try {
    const meetingService = new MeetingService();
    await meetingService.handleReminderSweep();
  } catch (e) {
    console.error('Fatal error in Meeting Reminder Sweep cron:', e);
  }
});

cron.schedule('0 8 * * *', async () => {
  console.log('Running daily Error Digest');
  try {
    await errorDigestService.runDailyDigest();
  } catch (e) {
    console.error('Fatal error in Error Digest cron:', e);
  }
});

cron.schedule('0 */4 * * *', async () => {
  console.log('Running 4-hourly Lead Sourcing via OSM');
  try {
    await leadSourcingService.runSourcing();
  } catch (e) {
    console.error('Fatal error in Lead Sourcing cron:', e);
  }
});

cron.schedule('0 * * * *', async () => {
  console.log('Running hourly Follow-up Engine');
  try {
    await followupEngineService.runFollowups();
  } catch (e) {
    console.error('Fatal error in Follow-up Engine cron:', e);
  }
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

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Graceful Shutdown Handler
const gracefulShutdown = async (signal: string) => {
  console.log(`\n[${signal}] Received. Shutting down gracefully...`);
  
  // 1. Stop all cron jobs safely (prevent new ones from starting)
  console.log('Stopping background cron engines...');
  const tasks = cron.getTasks();
  // Depending on node-cron version, getTasks() returns a Map
  for (const [_, task] of tasks) {
    task.stop();
  }

  // 2. Stop accepting new HTTP requests
  server.close(async () => {
    console.log('Closed out remaining HTTP connections.');
    
    // 3. Close Database connection safely
    try {
      const mongoose = await import('mongoose');
      await mongoose.connection.close(false);
      console.log('MongoDB connection closed.');
    } catch (err) {
      console.error('Error during MongoDB disconnect', err);
    }
    
    console.log('Graceful shutdown complete. Exiting process.');
    process.exit(0);
  });

  // Force shutdown if it takes longer than 10s
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
