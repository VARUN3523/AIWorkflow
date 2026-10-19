import crypto from 'node:crypto';
import { getDb } from '../db/index.js';


export const DEFAULT_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret_for_automated_e2e_suite_2026';

/**
 * Creates a Stripe Checkout Session for plan upgrades (F-BILL-02)
 */
export function createCheckoutSession({ workspaceId, planId, successUrl, cancelUrl }, db = getDb()) {
  const normalizedPlan = (planId || '').toLowerCase().trim();

  // Validate plan: Only paid tiers ('starter', 'pro') are eligible for checkout
  if (!normalizedPlan || !['starter', 'pro'].includes(normalizedPlan)) {
    const err = new Error(`Invalid plan "${planId}". Allowed upgrade plans: starter, pro`);
    err.statusCode = 400;
    err.code = 'INVALID_PLAN';
    throw err;
  }

  // Ensure workspace exists
  const workspace = db.prepare('SELECT id, name FROM workspaces WHERE id = ?').get(workspaceId);
  if (!workspace) {
    const err = new Error(`Workspace not found: ${workspaceId}`);
    err.statusCode = 404;
    err.code = 'WORKSPACE_NOT_FOUND';
    throw err;
  }

  const sessionId = `cs_test_${crypto.randomUUID().replace(/-/g, '')}`;
  const checkoutUrl = `https://checkout.stripe.com/c/pay/${sessionId}?plan=${normalizedPlan}&workspace=${workspaceId}`;

  return {
    sessionId,
    session_id: sessionId,
    checkoutUrl,
    checkout_url: checkoutUrl,
    planId: normalizedPlan,
    plan_id: normalizedPlan,
    workspaceId,
    workspace_id: workspaceId
  };
}

/**
 * Creates a Stripe Customer Billing Portal Session (F-BILL-03)
 */
export function createBillingPortalSession({ workspaceId, returnUrl }, db = getDb()) {
  // Ensure workspace exists
  const workspace = db.prepare('SELECT id, name FROM workspaces WHERE id = ?').get(workspaceId);
  if (!workspace) {
    const err = new Error(`Workspace not found: ${workspaceId}`);
    err.statusCode = 404;
    err.code = 'WORKSPACE_NOT_FOUND';
    throw err;
  }


  const portalSessionId = `bps_test_${crypto.randomUUID().replace(/-/g, '')}`;
  const effectiveReturnUrl = returnUrl || 'https://saas.example.com/app/billing';
  const portalUrl = `https://billing.stripe.com/p/session/${portalSessionId}?return=${encodeURIComponent(effectiveReturnUrl)}`;

  return {
    portalSessionId,
    portal_session_id: portalSessionId,
    portalUrl,
    portal_url: portalUrl,
    workspaceId,
    workspace_id: workspaceId
  };
}

/**
 * Validates Stripe webhook HMAC-SHA256 signature (F-BILL-04)
 * Header format: t=<timestamp>,v1=<signature>[,v1=...]
 */
export function verifyWebhookSignature(payload, signatureHeader, secret = DEFAULT_WEBHOOK_SECRET) {
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    const err = new Error('Missing stripe-signature header');
    err.statusCode = 400;
    err.code = 'INVALID_SIGNATURE';
    throw err;
  }

  const items = signatureHeader.split(',');
  let timestamp = null;
  const signatures = [];

  for (const item of items) {
    const parts = item.trim().split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      if (key === 't') {
        timestamp = val;
      } else if (key === 'v1' && val) {
        signatures.push(val);
      }
    }
  }

  if (!timestamp || signatures.length === 0) {
    const err = new Error('Malformed stripe-signature header format');
    err.statusCode = 400;
    err.code = 'INVALID_SIGNATURE';
    throw err;
  }

  // Normalize payload to string
  let payloadString;
  if (typeof payload === 'string') {
    payloadString = payload;
  } else if (Buffer.isBuffer(payload)) {
    payloadString = payload.toString('utf-8');
  } else if (payload && typeof payload === 'object') {
    payloadString = JSON.stringify(payload);
  } else {
    payloadString = '';
  }

  const signedPayload = `${timestamp}.${payloadString}`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(signedPayload);
  const expectedSignature = hmac.digest('hex');
  const expectedBuf = Buffer.from(expectedSignature, 'utf-8');

  let matchFound = false;
  for (const candidateSig of signatures) {
    const candidateBuf = Buffer.from(candidateSig, 'utf-8');
    if (expectedBuf.length === candidateBuf.length && crypto.timingSafeEqual(expectedBuf, candidateBuf)) {
      matchFound = true;
      break;
    }
  }

  if (!matchFound) {
    const err = new Error('Webhook signature verification failed');
    err.statusCode = 400;
    err.code = 'INVALID_SIGNATURE';
    throw err;
  }

  return true;
}

/**
 * Dispatches and processes verified Stripe webhook events (F-BILL-05)
 * Enforces idempotency via webhook_events table.
 */
export function handleWebhookEvent(event, db = getDb()) {
  if (!event || typeof event !== 'object' || !event.id || !event.type) {
    const err = new Error('Invalid webhook event payload');
    err.statusCode = 400;
    err.code = 'INVALID_EVENT';
    throw err;
  }

  // 1. Idempotency Guard (F-BILL-05)
  const existing = db.prepare('SELECT id, status FROM webhook_events WHERE id = ?').get(event.id);
  if (existing) {
    return {
      received: true,
      idempotent: true,
      already_processed: true,
      event_id: event.id,
      type: event.type
    };
  }

  const nowIso = new Date().toISOString();

  // 2. Process event by type
  switch (event.type) {
    case 'checkout.session.completed': {
      const sessionObj = event.data?.object || {};
      const workspaceId =
        sessionObj.client_reference_id ||
        sessionObj.metadata?.workspace_id ||
        sessionObj.metadata?.workspaceId;
      const planId = sessionObj.metadata?.plan_id || sessionObj.metadata?.planId || 'starter';
      const customerId = sessionObj.customer || null;
      const subscriptionId = sessionObj.subscription || null;

      if (workspaceId) {
        const periodEndIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const existingSub = db.prepare('SELECT id FROM subscriptions WHERE workspace_id = ?').get(workspaceId);

        if (existingSub) {
          db.prepare(`
            UPDATE subscriptions
            SET plan_id = ?,
                stripe_customer_id = coalesce(?, stripe_customer_id),
                stripe_subscription_id = coalesce(?, stripe_subscription_id),
                status = 'active',
                current_period_end = ?,
                updated_at = ?
            WHERE workspace_id = ?
          `).run(planId, customerId, subscriptionId, periodEndIso, nowIso, workspaceId);
        } else {
          const subId = `sub_${crypto.randomUUID().replace(/-/g, '')}`;
          db.prepare(`
            INSERT INTO subscriptions (
              id, workspace_id, stripe_customer_id, stripe_subscription_id,
              plan_id, status, current_period_start, current_period_end, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
          `).run(subId, workspaceId, customerId, subscriptionId, planId, nowIso, periodEndIso, nowIso);
        }
      }
      break;
    }

    case 'customer.subscription.updated': {
      const subObj = event.data?.object || {};
      const workspaceId =
        subObj.metadata?.workspace_id ||
        subObj.metadata?.workspaceId ||
        (() => {
          const row = db.prepare('SELECT workspace_id FROM subscriptions WHERE stripe_subscription_id = ?').get(subObj.id);
          return row?.workspace_id;
        })();

      const status = subObj.status || 'active';
      const planId = subObj.metadata?.plan_id || subObj.metadata?.planId;

      if (workspaceId) {
        if (planId) {
          db.prepare(`
            UPDATE subscriptions
            SET status = ?, plan_id = ?, updated_at = ?
            WHERE workspace_id = ?
          `).run(status, planId, nowIso, workspaceId);
        } else {
          db.prepare(`
            UPDATE subscriptions
            SET status = ?, updated_at = ?
            WHERE workspace_id = ?
          `).run(status, nowIso, workspaceId);
        }
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subObj = event.data?.object || {};
      const workspaceId =
        subObj.metadata?.workspace_id ||
        subObj.metadata?.workspaceId ||
        (() => {
          const row = db.prepare('SELECT workspace_id FROM subscriptions WHERE stripe_subscription_id = ?').get(subObj.id);
          return row?.workspace_id;
        })();

      if (workspaceId) {
        db.prepare(`
          UPDATE subscriptions
          SET plan_id = 'free', status = 'canceled', updated_at = ?
          WHERE workspace_id = ?
        `).run(nowIso, workspaceId);
      }
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoiceObj = event.data?.object || {};
      const workspaceId =
        invoiceObj.subscription_details?.metadata?.workspace_id ||
        invoiceObj.metadata?.workspace_id ||
        invoiceObj.metadata?.workspaceId;

      if (workspaceId) {
        db.prepare(`
          UPDATE subscriptions
          SET status = 'active', updated_at = ?
          WHERE workspace_id = ?
        `).run(nowIso, workspaceId);
      }
      break;
    }

    default:
      // Other unhandled events logged safely without error
      break;
  }

  // 3. Record event in webhook_events table for idempotency
  db.prepare(`
    INSERT INTO webhook_events (id, event_type, payload, status, created_at)
    VALUES (?, ?, ?, 'processed', ?)
  `).run(event.id, event.type, JSON.stringify(event), nowIso);

  return {
    received: true,
    event_id: event.id,
    type: event.type,
    status: 'processed'
  };
}
