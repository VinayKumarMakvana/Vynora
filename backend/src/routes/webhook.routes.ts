import { Router } from 'express';
import express from 'express';
import { handleStripeWebhook, handleCalendlyWebhook } from '../controllers/webhook.controller';

const router = Router();

// Stripe requires the raw body to verify the signature
router.post('/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);

// Calendly can use standard JSON parsing, which is configured globally, 
// but we explicitly use json parser here if it wasn't caught globally
router.post('/calendly', express.json(), handleCalendlyWebhook);

export default router;
