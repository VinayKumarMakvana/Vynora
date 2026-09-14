import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { connectDB } from '../src/config/db';
import { leadSourcingService } from '../src/services/leadSourcing.service';
import { outboundMachineService } from '../src/services/outboundMachine.service';
import { followupEngineService } from '../src/services/followupEngine.service';
import { inboundHandlerService } from '../src/services/inboundHandler.service';
import { Lead } from '../src/models/Lead';

dotenv.config();

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function startWorker() {
  console.log('===================================================');
  console.log('🚀 VYNORA 24/7 AUTONOMOUS WORKER STARTED');
  console.log('===================================================');
  
  await connectDB();
  
  let cycleCount = 1;

  while (true) {
    console.log(`\n--- [Cycle #${cycleCount}] Starting at ${new Date().toLocaleTimeString()} ---`);
    
    try {
      // 1. INBOX SCANNING (Quick, runs every cycle)
      console.log('[1/4] Checking Inbox for Replies...');
      try {
        await inboundHandlerService.pollUnreadEmails();
      } catch (e: any) {
        console.error('Inbox Error (Ignored):', e.message);
      }
      
      // 2. FOLLOW-UP ENGINE
      console.log('[2/4] Running Follow-up Engine...');
      try {
        await followupEngineService.runFollowups();
      } catch (e: any) {
        console.error('Follow-up Error (Ignored):', e.message);
      }

      // 3. SMART SOURCING — triggers when fresh/eligible queue is low
      console.log('[3/4] Checking Lead Queue...');
      const pendingLeads = await Lead.countDocuments({ status: 'new', outreach_eligible: true });
      const contactedToday = await Lead.countDocuments({ status: 'contacted' });
      console.log(`Queue: ${pendingLeads} eligible | ${contactedToday} already contacted.`);
      
      if (pendingLeads < 25) {
        console.log(`Queue is low (< 25). Firing up Sourcing Engine to find fresh leads...`);
        try {
          await leadSourcingService.runSourcing(`worker-${Date.now()}`);
        } catch (e: any) {
          console.error('Sourcing Error (Ignored):', e.message);
        }
      } else {
        console.log(`Queue is healthy (${pendingLeads} leads). Skipping Sourcing to save AI tokens.`);
      }

      // 4. OUTBOUND MACHINE
      console.log('[4/4] Firing Outbound Machine...');
      try {
        const result = await outboundMachineService.runMachine(`worker-${Date.now()}`);
        if (result.message === 'Budget cap reached') {
          console.log('🎯 DAILY/SHIFT CAP REACHED! Outbound will pause until next shift.');
        } else {
          console.log(`Outbound processed: ${result.processed || 0} leads.`);
        }
      } catch (e: any) {
        console.error('Outbound Error (Ignored):', e.message);
      }

    } catch (fatalError: any) {
      console.error('!!! FATAL CYCLE ERROR !!!', fatalError);
    }
    
    console.log(`--- [Cycle #${cycleCount}] Completed ---`);
    console.log('Sleeping for 5 minutes before next cycle...');
    
    // Sleep for 5 minutes (300,000 ms) before running again
    await delay(300000);
    cycleCount++;
  }
}

// Handle unexpected crashes so it NEVER exits
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err);
  console.log('Worker will ignore and continue next cycle...');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection:', reason);
});

startWorker();
