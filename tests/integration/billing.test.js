import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import crypto from 'node:crypto';
import app from '../../src/app.js';
import { setupTestDb } from '../helpers/test_db.js';
import {
  TIERS,
  PLAN_LIMITS,
  getTier,
  getAllTiers,
  checkQuota,
  checkAndIncrementQuota,
  getUsageStatus,
  incrementUsage
} from '../../src/billing/service.js';
import {
  createCheckoutSession,
  createBillingPortalSession,
  verifyWebhookSignature,
  handleWebhookEvent,
  DEFAULT_WEBHOOK_SECRET
} from '../../src/billing/stripe.js';
import {
  STRIPE_TEST_WEBHOOK_SECRET,
  createStripeSignature,
  createCheckoutSessionCompletedEvent,
  createSubscriptionUpdatedEvent,
  createSubscriptionDeletedEvent,
  createInvoicePaymentSucceededEvent
} from '../fixtures/stripe.js';

describe('Subscription Billing & Usage Metering Integration Tests (R3: F-BILL-01 to F-BILL-08)', () => {
  let testDb;

  beforeEach(() => {
    testDb = setupTestDb();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  async function registerTenantUser(email = 'billing_test@example.com', fullName = 'Billing Tester') {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email,
        password: 'Password123!Secure',
        fullName,
        workspaceName: 'Billing Test Workspace'
      });

    return {
      user: res.body.user,
      workspace: res.body.workspace,
      token: res.body.token,
      authHeader: `Bearer ${res.body.token}`
    };
  }

  // =========================================================================
  // 1. Tier Definitions & Catalog (F-BILL-01)
  // =========================================================================
  describe('F-BILL-01: Plan Tier Definitions', () => {
    it('defines Free, Starter, and Pro tiers with exact limits and pricing', () => {
      // Free / Trial
      assert.strictEqual(TIERS.free.id, 'free');
      assert.strictEqual(TIERS.free.monthly_runs, 50);
      assert.strictEqual(TIERS.free.max_workflows, 3);
      assert.strictEqual(TIERS.free.price_monthly, 0);

      // Starter
      assert.strictEqual(TIERS.starter.id, 'starter');
      assert.strictEqual(TIERS.starter.monthly_runs, 1000);
      assert.strictEqual(TIERS.starter.max_workflows, 25);
      assert.strictEqual(TIERS.starter.price_monthly, 29);

      // Pro
      assert.strictEqual(TIERS.pro.id, 'pro');
      assert.strictEqual(TIERS.pro.monthly_runs, 10000);
      assert.strictEqual(TIERS.pro.max_workflows, Infinity);
      assert.strictEqual(TIERS.pro.price_monthly, 99);

      // Backwards compatible PLAN_LIMITS map
      assert.strictEqual(PLAN_LIMITS.free, 50);
      assert.strictEqual(PLAN_LIMITS.starter, 1000);
      assert.strictEqual(PLAN_LIMITS.pro, 10000);
    });

    it('getTier resolves tier by id with fallback to free', () => {
      assert.strictEqual(getTier('starter').monthly_runs, 1000);
      assert.strictEqual(getTier('PRO').monthly_runs, 10000);
      assert.strictEqual(getTier('nonexistent').id, 'free');
      assert.strictEqual(getTier(null).id, 'free');
    });

    it('GET /api/billing/tiers returns complete tier catalog', async () => {
      const res = await request(app).get('/api/billing/tiers');
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.tiers));
      assert.strictEqual(res.body.tiers.length, 3);

      const planIds = res.body.tiers.map((t) => t.id);
      assert.deepStrictEqual(planIds, ['free', 'starter', 'pro']);
    });
  });

  // =========================================================================
  // 2. Usage Status Endpoint (F-BILL-08)
  // =========================================================================
  describe('F-BILL-08: GET /api/billing/usage', () => {
    it('returns 401 when no auth token is provided', async () => {
      const res = await request(app).get('/api/billing/usage');
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, 'UNAUTHORIZED');
    });

    it('returns correct initial usage for newly registered workspace', async () => {
      const { token, workspace } = await registerTenantUser('usage_user@example.com');

      const res = await request(app)
        .get('/api/billing/usage')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.plan_id, 'free');
      assert.strictEqual(res.body.runs_used, 0);
      assert.strictEqual(res.body.runs_limit, 50);
      assert.strictEqual(res.body.percentage, 0);
      assert.ok(res.body.resets_at);
    });
  });

  // =========================================================================
  // 3. Stripe Checkout Session Creation (F-BILL-02)
  // =========================================================================
  describe('F-BILL-02: POST /api/billing/checkout', () => {
    it('generates checkout URL and session ID for Starter upgrade', async () => {
      const { token, workspace } = await registerTenantUser('checkout_starter@example.com');

      const res = await request(app)
        .post('/api/billing/checkout')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({
          plan_id: 'starter',
          success_url: 'https://saas.example.com/billing?status=success',
          cancel_url: 'https://saas.example.com/billing?status=canceled'
        });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.checkout_url);
      assert.ok(res.body.session_id);
      assert.strictEqual(res.body.plan_id, 'starter');
      assert.match(res.body.checkout_url, /https:\/\/checkout\.stripe\.com/);
    });

    it('generates checkout URL and session ID for Pro upgrade', async () => {
      const { token, workspace } = await registerTenantUser('checkout_pro@example.com');

      const res = await request(app)
        .post('/api/billing/checkout')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({
          planId: 'pro',
          successUrl: 'https://saas.example.com/billing/success',
          cancelUrl: 'https://saas.example.com/billing/cancel'
        });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.checkout_url);
      assert.ok(res.body.session_id);
      assert.strictEqual(res.body.plan_id, 'pro');
    });

    it('rejects invalid or unsupported plan tier with 400 Bad Request', async () => {
      const { token, workspace } = await registerTenantUser('checkout_invalid@example.com');

      const res = await request(app)
        .post('/api/billing/checkout')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({ plan_id: 'enterprise_galactic_tier_99' });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'INVALID_PLAN');
    });

    it('rejects checkout request for free plan with 400 Bad Request', async () => {
      const { token, workspace } = await registerTenantUser('checkout_free@example.com');

      const res = await request(app)
        .post('/api/billing/checkout')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({ plan_id: 'free' });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'INVALID_PLAN');
    });

    it('requires authentication', async () => {
      const res = await request(app)
        .post('/api/billing/checkout')
        .send({ plan_id: 'starter' });

      assert.strictEqual(res.status, 401);
    });
  });

  // =========================================================================
  // 4. Stripe Customer Billing Portal Session (F-BILL-03)
  // =========================================================================
  describe('F-BILL-03: POST /api/billing/portal', () => {
    it('generates customer billing portal session URL', async () => {
      const { token, workspace } = await registerTenantUser('portal_user@example.com');

      const res = await request(app)
        .post('/api/billing/portal')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({ return_url: 'https://saas.example.com/app/billing' });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.portal_url);
      assert.match(res.body.portal_url, /https:\/\/billing\.stripe\.com/);
    });

    it('requires authentication', async () => {
      const res = await request(app).post('/api/billing/portal').send({});
      assert.strictEqual(res.status, 401);
    });
  });

  // =========================================================================
  // 5. Stripe Webhook Verification & HMAC (F-BILL-04)
  // =========================================================================
  describe('F-BILL-04: Stripe Webhook Signature Verification', () => {
    it('accepts correctly signed webhook requests with valid HMAC-SHA256 signature', async () => {
      const { workspace } = await registerTenantUser('webhook_valid@example.com');
      const event = createCheckoutSessionCompletedEvent(workspace.id, 'starter');
      const sig = createStripeSignature(event, STRIPE_TEST_WEBHOOK_SECRET);

      const res = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', sig)
        .send(event);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.received, true);
    });

    it('rejects webhook with missing stripe-signature header with 400 Bad Request', async () => {
      const event = createCheckoutSessionCompletedEvent('ws_123', 'starter');

      const res = await request(app)
        .post('/api/webhooks/stripe')
        .send(event);

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'INVALID_SIGNATURE');
    });

    it('rejects webhook with forged or tampered signature with 400 Bad Request', async () => {
      const event = createCheckoutSessionCompletedEvent('ws_123', 'starter');

      const res = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', 't=1700000000,v1=bad_forged_signature_hex_value')
        .send(event);

      assert.strictEqual(res.status, 400);
      assert.match(res.body.message || res.body.error, /signature/i);
    });

    it('rejects webhook signed with wrong secret key with 400 Bad Request', async () => {
      const event = createCheckoutSessionCompletedEvent('ws_123', 'starter');
      const wrongSig = createStripeSignature(event, 'whsec_wrong_unauthorized_key_999');

      const res = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', wrongSig)
        .send(event);

      assert.strictEqual(res.status, 400);
    });
  });

  // =========================================================================
  // 6. Webhook Event Processing & Idempotency (F-BILL-05)
  // =========================================================================
  describe('F-BILL-05: Webhook Event Dispatcher & Idempotency Guard', () => {
    it('upgrades subscription to starter on checkout.session.completed', async () => {
      const { token, workspace } = await registerTenantUser('wh_upgrade_starter@example.com');

      const event = createCheckoutSessionCompletedEvent(workspace.id, 'starter');
      const sig = createStripeSignature(event, STRIPE_TEST_WEBHOOK_SECRET);

      const res = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', sig)
        .send(event);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.received, true);

      // Verify database updated
      const sub = testDb.db
        .prepare('SELECT plan_id, status FROM subscriptions WHERE workspace_id = ?')
        .get(workspace.id);
      assert.strictEqual(sub.plan_id, 'starter');
      assert.strictEqual(sub.status, 'active');

      // Verify usage endpoint reflects starter limit (1000)
      const usageRes = await request(app)
        .get('/api/billing/usage')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id);
      assert.strictEqual(usageRes.body.plan_id, 'starter');
      assert.strictEqual(usageRes.body.runs_limit, 1000);
    });

    it('upgrades subscription to pro on checkout.session.completed', async () => {
      const { token, workspace } = await registerTenantUser('wh_upgrade_pro@example.com');

      const event = createCheckoutSessionCompletedEvent(workspace.id, 'pro');
      const sig = createStripeSignature(event, STRIPE_TEST_WEBHOOK_SECRET);

      const res = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', sig)
        .send(event);

      assert.strictEqual(res.status, 200);

      // Verify database updated
      const sub = testDb.db
        .prepare('SELECT plan_id, status FROM subscriptions WHERE workspace_id = ?')
        .get(workspace.id);
      assert.strictEqual(sub.plan_id, 'pro');

      // Verify usage endpoint reflects pro limit (10000)
      const usageRes = await request(app)
        .get('/api/billing/usage')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id);
      assert.strictEqual(usageRes.body.plan_id, 'pro');
      assert.strictEqual(usageRes.body.runs_limit, 10000);
    });

    it('idempotency guard prevents duplicate processing of identical event ID', async () => {
      const { workspace } = await registerTenantUser('wh_idempotency@example.com');

      const event = createCheckoutSessionCompletedEvent(workspace.id, 'starter');
      const sig = createStripeSignature(event, STRIPE_TEST_WEBHOOK_SECRET);

      // First delivery
      const res1 = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', sig)
        .send(event);
      assert.strictEqual(res1.status, 200);

      // Verify recorded in webhook_events table
      const recorded = testDb.db
        .prepare('SELECT id, event_type, status FROM webhook_events WHERE id = ?')
        .get(event.id);
      assert.ok(recorded);
      assert.strictEqual(recorded.id, event.id);

      // Second delivery of same event
      const res2 = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', sig)
        .send(event);
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.body.idempotent, true);

      // Count of events in table should remain 1
      const count = testDb.db
        .prepare('SELECT COUNT(*) as cnt FROM webhook_events WHERE id = ?')
        .get(event.id);
      assert.strictEqual(count.cnt, 1);
    });

    it('processes customer.subscription.updated event', async () => {
      const { workspace } = await registerTenantUser('wh_sub_updated@example.com');

      const event = createSubscriptionUpdatedEvent(workspace.id, 'pro', 'active');
      const sig = createStripeSignature(event, STRIPE_TEST_WEBHOOK_SECRET);

      const res = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', sig)
        .send(event);
      assert.strictEqual(res.status, 200);

      const sub = testDb.db
        .prepare('SELECT plan_id, status FROM subscriptions WHERE workspace_id = ?')
        .get(workspace.id);
      assert.strictEqual(sub.plan_id, 'pro');
      assert.strictEqual(sub.status, 'active');
    });

    it('processes customer.subscription.deleted event by reverting to free', async () => {
      const { workspace } = await registerTenantUser('wh_sub_deleted@example.com');

      // First upgrade to pro
      testDb.db
        .prepare("UPDATE subscriptions SET plan_id = 'pro', status = 'active' WHERE workspace_id = ?")
        .run(workspace.id);

      const event = createSubscriptionDeletedEvent(workspace.id);
      const sig = createStripeSignature(event, STRIPE_TEST_WEBHOOK_SECRET);

      const res = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', sig)
        .send(event);
      assert.strictEqual(res.status, 200);

      const sub = testDb.db
        .prepare('SELECT plan_id, status FROM subscriptions WHERE workspace_id = ?')
        .get(workspace.id);
      assert.strictEqual(sub.plan_id, 'free');
      assert.strictEqual(sub.status, 'canceled');
    });

    it('processes invoice.payment_succeeded event', async () => {
      const { workspace } = await registerTenantUser('wh_inv_paid@example.com');

      const event = createInvoicePaymentSucceededEvent(workspace.id);
      const sig = createStripeSignature(event, STRIPE_TEST_WEBHOOK_SECRET);

      const res = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', sig)
        .send(event);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.received, true);
    });
  });

  // =========================================================================
  // 7. Usage Metering & Pre-Flight Quota Enforcement (F-BILL-06, F-BILL-07)
  // =========================================================================
  describe('F-BILL-06 & F-BILL-07: Usage Metering & Quota Gatekeeper', () => {
    it('incrementUsage atomically increments runs and ai_steps counts', () => {
      const workspaceId = 'ws_direct_meter_test';
      testDb.db.prepare(`
        INSERT INTO workspaces (id, name, slug, owner_id)
        VALUES (?, 'Direct Test WS', 'direct-test-ws', 'usr_owner')
      `).run(workspaceId);

      const initial = checkQuota(workspaceId, testDb.db);
      assert.strictEqual(initial.runs_used, 0);

      incrementUsage(workspaceId, { runs: 5, aiSteps: 15 }, testDb.db);

      const updated = checkQuota(workspaceId, testDb.db);
      assert.strictEqual(updated.runs_used, 5);
      assert.strictEqual(updated.ai_steps_used, 15);
    });

    it('checkAndIncrementQuota increments counter when under quota limit', () => {
      const workspaceId = 'ws_check_inc_test';
      testDb.db.prepare(`
        INSERT INTO workspaces (id, name, slug, owner_id)
        VALUES (?, 'Check Inc WS', 'check-inc-ws', 'usr_owner')
      `).run(workspaceId);

      const r1 = checkAndIncrementQuota(workspaceId, testDb.db);
      assert.strictEqual(r1.allowed, true);
      assert.strictEqual(r1.runs_used, 1);

      const r2 = checkAndIncrementQuota(workspaceId, testDb.db);
      assert.strictEqual(r2.allowed, true);
      assert.strictEqual(r2.runs_used, 2);
    });

    it('checkAndIncrementQuota throws 429 when quota limit is reached', () => {
      const workspaceId = 'ws_quota_block_test';
      testDb.db.prepare(`
        INSERT INTO workspaces (id, name, slug, owner_id)
        VALUES (?, 'Quota Block WS', 'quota-block-ws', 'usr_owner')
      `).run(workspaceId);

      // Set usage to 50 (Free limit reached)
      testDb.db.prepare(`
        INSERT INTO usage_meters (id, workspace_id, billing_period, runs_count, ai_steps_count)
        VALUES ('meter_block_1', ?, '2026-10', 50, 0)
      `).run(workspaceId);

      assert.throws(
        () => checkAndIncrementQuota(workspaceId, testDb.db),
        (err) => {
          assert.strictEqual(err.statusCode, 429);
          assert.strictEqual(err.code, 'QUOTA_EXCEEDED');
          assert.strictEqual(err.limit, 50);
          assert.match(err.message, /plan limit of 50 runs reached/i);
          return true;
        }
      );
    });

    it('workflow execution succeeds at exact limit (50/50) and blocks at 51/50', async () => {
      const { token, workspace } = await registerTenantUser('run_boundary@example.com');

      // Create workflow
      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({
          name: 'Boundary Test Workflow',
          trigger_type: 'manual',
          steps: [{ id: 's1', name: 'Extract Step', type: 'doc_extraction', order: 1, config: {} }]
        });
      assert.strictEqual(wfRes.status, 201);
      const workflowId = wfRes.body.workflow.id;

      // Set usage to 49/50
      testDb.db
        .prepare('UPDATE usage_meters SET runs_count = 49 WHERE workspace_id = ?')
        .run(workspace.id);

      // Run 50 (should succeed)
      const run50Res = await request(app)
        .post('/api/workflows/triggers/manual')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({ workflow_id: workflowId });
      assert.strictEqual(run50Res.status, 200);

      // Verify meter now at 50/50
      const meterAt50 = testDb.db
        .prepare('SELECT runs_count FROM usage_meters WHERE workspace_id = ?')
        .get(workspace.id);
      assert.strictEqual(meterAt50.runs_count, 50);

      // Run 51 (must be blocked with 429 Quota Exceeded)
      const run51Res = await request(app)
        .post('/api/workflows/triggers/manual')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({ workflow_id: workflowId });

      assert.strictEqual(run51Res.status, 429);
      assert.strictEqual(run51Res.body.error, 'QUOTA_EXCEEDED');
      assert.match(run51Res.body.message, /plan limit of 50 runs reached/i);
      assert.strictEqual(run51Res.body.limit, 50);
      assert.strictEqual(run51Res.body.current_usage, 50);

      // Counter should NOT have incremented beyond 50
      const meterAfterBlock = testDb.db
        .prepare('SELECT runs_count FROM usage_meters WHERE workspace_id = ?')
        .get(workspace.id);
      assert.strictEqual(meterAfterBlock.runs_count, 50);
    });

    it('upgrading via Stripe webhook unblocks workflow executions', async () => {
      const { token, workspace } = await registerTenantUser('upgrade_recovery@example.com');

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({
          name: 'Recovery Workflow',
          trigger_type: 'manual',
          steps: [{ id: 's1', name: 'Step 1', type: 'doc_extraction', order: 1, config: {} }]
        });
      assert.strictEqual(wfRes.status, 201);
      const workflowId = wfRes.body.workflow.id;

      // Set to 50 (blocked)
      testDb.db
        .prepare('UPDATE usage_meters SET runs_count = 50 WHERE workspace_id = ?')
        .run(workspace.id);

      // Verify blocked
      const blockedRes = await request(app)
        .post('/api/workflows/triggers/manual')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({ workflow_id: workflowId });
      assert.strictEqual(blockedRes.status, 429);

      // Upgrade to Starter via Webhook
      const event = createCheckoutSessionCompletedEvent(workspace.id, 'starter');
      const sig = createStripeSignature(event, STRIPE_TEST_WEBHOOK_SECRET);
      const webhookRes = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', sig)
        .send(event);
      assert.strictEqual(webhookRes.status, 200);

      // Execution should now succeed (50 / 1000 Starter limit)
      const unblockedRes = await request(app)
        .post('/api/workflows/triggers/manual')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({ workflow_id: workflowId });
      assert.strictEqual(unblockedRes.status, 200);
      assert.strictEqual(unblockedRes.body.status, 'completed');
    });
  });
});
