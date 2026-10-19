import { Router } from 'express';
import { authenticate } from '../auth/middleware.js';
import {
  getUsageStatus,
  getAllTiers
} from './service.js';
import {
  createCheckoutSession,
  createBillingPortalSession,
  verifyWebhookSignature,
  handleWebhookEvent
} from './stripe.js';

const billingRouter = Router();
const webhookRouter = Router();

// =========================================================================
// 1. Billing Routes (Mounted under /api/billing)
// =========================================================================

/**
 * GET /api/billing/tiers
 * Returns catalog of available plan tiers
 */
billingRouter.get('/tiers', (req, res) => {
  res.status(200).json({ tiers: getAllTiers() });
});

/**
 * GET /api/billing/usage
 * Returns current monthly usage, limits, and plan details (F-BILL-08)
 */
billingRouter.get('/usage', authenticate, (req, res, next) => {
  try {
    const status = getUsageStatus(req.workspaceId);
    res.status(200).json(status);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/checkout
 * Generates Stripe Checkout Session URL for plan upgrades (F-BILL-02)
 */
billingRouter.post('/checkout', authenticate, (req, res, next) => {
  try {
    const planId = req.body.plan_id || req.body.planId;
    const successUrl = req.body.success_url || req.body.successUrl;
    const cancelUrl = req.body.cancel_url || req.body.cancelUrl;

    const result = createCheckoutSession({
      workspaceId: req.workspaceId,
      planId,
      successUrl,
      cancelUrl
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/portal
 * Generates Stripe Customer Billing Portal Session URL (F-BILL-03)
 */
billingRouter.post('/portal', authenticate, (req, res, next) => {
  try {
    const returnUrl = req.body.return_url || req.body.returnUrl;

    const result = createBillingPortalSession({
      workspaceId: req.workspaceId,
      returnUrl
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// =========================================================================
// 2. Stripe Webhook Handler (Mounted under /api/webhooks/stripe)
// =========================================================================

async function handleStripeWebhook(req, res, next) {
  try {
    const sigHeader = req.headers['stripe-signature'];
    const rawPayload = req.rawBody || req.body;

    // Verify cryptographic HMAC signature
    verifyWebhookSignature(rawPayload, sigHeader);

    // Process event with idempotency guard
    const event = typeof req.body === 'object' && req.body !== null
      ? req.body
      : JSON.parse(typeof rawPayload === 'string' ? rawPayload : rawPayload.toString('utf-8'));

    const result = handleWebhookEvent(event);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

webhookRouter.post('/stripe', handleStripeWebhook);

// Also support mounting directly under billing router for convenience
billingRouter.post('/webhook', handleStripeWebhook);
billingRouter.post('/webhooks/stripe', handleStripeWebhook);

export { billingRouter, webhookRouter };
export default billingRouter;
