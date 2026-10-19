import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  request,
  app,
  setupTestDb,
  requireFeature,
  registerTenantUser,
  STRIPE_TEST_WEBHOOK_SECRET,
  createStripeSignature,
  createCheckoutSessionCompletedEvent,
  sampleValidInvoiceText,
  enterpriseLeadPayload,
  invoiceProcessingWorkflow,
  webhookLeadWorkflow
} from './harness.js';

describe('Tier 4: Real-World Application Scenarios (Production Journeys)', () => {
  let testDb;

  beforeEach(() => {
    testDb = setupTestDb();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  // =========================================================================
  // Scenario 1: Accounts Payable (AP) Invoice Processing Pipeline
  // =========================================================================
  it('T4-SCEN-01: Realistic Accounts Payable (AP) Invoice Processing Pipeline', async (t) => {
    const okAuth = await requireFeature(t, 'auth', 'Milestone 1');
    if (!okAuth) return;
    const okEngine = await requireFeature(t, 'engine', 'Milestone 2 & 3');
    if (!okEngine) return;

    // 1. Enterprise accounting tenant registers
    const { token, workspace } = await registerTenantUser({
      email: 'ap.controller@apex-finance.com',
      password: 'Password123!Secure',
      fullName: 'Apex Finance Controller'
    });

    // 2. Configure AP invoice pipeline
    const wfRes = await request(app)
      .post('/api/workflows')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspace.id)
      .send(invoiceProcessingWorkflow);
    assert.strictEqual(wfRes.status, 201);
    const workflowId = wfRes.body.workflow.id;

    // 3. Trigger execution with realistic enterprise vendor invoice
    const runRes = await request(app)
      .post(`/api/workflows/${workflowId}/run`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspace.id)
      .send({ document_text: sampleValidInvoiceText });

    assert.strictEqual(runRes.status, 200);
    const executionId = runRes.body.execution.id;
    assert.strictEqual(runRes.body.execution.status, 'completed');

    // 4. Fetch and verify step-level execution trace
    const traceRes = await request(app)
      .get(`/api/executions/${executionId}/trace`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspace.id);

    assert.strictEqual(traceRes.status, 200);
    assert.strictEqual(traceRes.body.steps.length, 3);

    const [extractStep, classifyStep, synthStep] = traceRes.body.steps;

    // Step 1: Extraction verification
    assert.strictEqual(extractStep.step_type, 'doc_extraction');
    assert.strictEqual(extractStep.status, 'success');
    assert.ok(extractStep.output_data?.fields?.vendor_name, 'Should extract vendor name');

    // Step 2: Classification verification
    assert.strictEqual(classifyStep.step_type, 'classification');
    assert.strictEqual(classifyStep.status, 'success');
    assert.ok(classifyStep.output_data?.category, 'Should assign classification category');

    // Step 3: Synthesis verification
    assert.strictEqual(synthStep.step_type, 'synthesis');
    assert.strictEqual(synthStep.status, 'success');
    assert.ok(synthStep.output_data?.summary, 'Should produce CFO approval brief summary');
  });

  // =========================================================================
  // Scenario 2: Inbound B2B SaaS Lead Qualification & Routing Pipeline
  // =========================================================================
  it('T4-SCEN-02: Inbound B2B SaaS Lead Qualification & Routing Pipeline', async (t) => {
    const okAuth = await requireFeature(t, 'auth', 'Milestone 1');
    if (!okAuth) return;
    const okEngine = await requireFeature(t, 'engine', 'Milestone 2 & 3');
    if (!okEngine) return;

    // 1. Sales operations team registers
    const { token, workspace } = await registerTenantUser({
      email: 'revops@cloudsaas-crm.com',
      password: 'Password123!Secure',
      fullName: 'VP Revenue Operations'
    });

    // 2. Configure lead qualification webhook workflow
    const wfRes = await request(app)
      .post('/api/workflows')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspace.id)
      .send(webhookLeadWorkflow);
    assert.strictEqual(wfRes.status, 201);

    const webhookToken = webhookLeadWorkflow.trigger_config.webhook_token;

    // 3. External demo request webhook arrives with Fortune 500 prospect payload
    const triggerRes = await request(app)
      .post(`/api/workflows/triggers/webhook/${webhookToken}`)
      .send(enterpriseLeadPayload);

    assert.strictEqual(triggerRes.status, 200);
    const executionId = triggerRes.body.execution_id || triggerRes.body.execution?.id;
    assert.ok(executionId);

    // 4. Authenticated sales rep inspects qualification trace
    const traceRes = await request(app)
      .get(`/api/executions/${executionId}/trace`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspace.id);

    assert.strictEqual(traceRes.status, 200);
    const leadScoreStep = traceRes.body.steps.find((s) => s.step_type === 'classification');
    assert.ok(leadScoreStep);
    assert.strictEqual(leadScoreStep.status, 'success');
  });

  // =========================================================================
  // Scenario 3: Multi-Tenant Subscription Growth & Scale Journey
  // =========================================================================
  it('T4-SCEN-03: Multi-Tenant Subscription Growth & Scale Journey', async (t) => {
    const okAuth = await requireFeature(t, 'auth', 'Milestone 1');
    if (!okAuth) return;
    const okBill = await requireFeature(t, 'billing', 'Milestone 4 (Billing)');
    if (!okBill) return;
    const okEngine = await requireFeature(t, 'engine', 'Milestone 2 & 3');
    if (!okEngine) return;

    // 1. Startup signs up on Free tier (50 monthly run quota)
    const { token, workspace } = await registerTenantUser({
      email: 'founder@hypergrowth-ai.io',
      password: 'Password123!Secure',
      fullName: 'HyperGrowth AI Founder'
    });

    // Create genuine workflow
    const wfRes = await request(app)
      .post('/api/workflows')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspace.id)
      .send({
        name: 'Startup AI Pipeline',
        trigger_type: 'manual',
        steps: [{ id: 's1', name: 'Extract Invoice', type: 'doc_extraction', order: 1, config: {} }]
      });
    assert.strictEqual(wfRes.status, 201);
    const workflowId = wfRes.body.workflow.id;

    // Verify initial subscription is Free with 50 limit
    const initialUsageRes = await request(app)
      .get('/api/billing/usage')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspace.id);
    assert.strictEqual(initialUsageRes.status, 200);
    assert.strictEqual(initialUsageRes.body.plan_id, 'free');
    assert.strictEqual(initialUsageRes.body.runs_limit, 50);

    // 2. High usage exhausts quota
    testDb.db
      .prepare('UPDATE usage_meters SET runs_count = 50 WHERE workspace_id = ?')
      .run(workspace.id);

    // 3. Next execution is blocked
    const blockedRes = await request(app)
      .post('/api/workflows/triggers/manual')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspace.id)
      .send({ workflow_id: workflowId });
    assert.strictEqual(blockedRes.status, 429);
    assert.strictEqual(blockedRes.body.error, 'QUOTA_EXCEEDED');

    // 4. Founder creates Stripe checkout session for Pro plan ($99/mo, 10,000 runs)
    const checkoutRes = await request(app)
      .post('/api/billing/checkout')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspace.id)
      .send({
        plan_id: 'pro',
        success_url: 'https://hypergrowth-ai.io/billing/success',
        cancel_url: 'https://hypergrowth-ai.io/billing/cancel'
      });
    assert.strictEqual(checkoutRes.status, 200);
    assert.ok(checkoutRes.body.checkout_url);

    // 5. Stripe webhook delivers checkout.session.completed
    const event = createCheckoutSessionCompletedEvent(workspace.id, 'pro');
    const sig = createStripeSignature(event, STRIPE_TEST_WEBHOOK_SECRET);
    const webhookRes = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', sig)
      .send(event);
    assert.strictEqual(webhookRes.status, 200);

    // 6. Upgraded usage reflects Pro tier with 10,000 ceiling
    const upgradedUsageRes = await request(app)
      .get('/api/billing/usage')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspace.id);
    assert.strictEqual(upgradedUsageRes.status, 200);
    assert.strictEqual(upgradedUsageRes.body.plan_id, 'pro');
    assert.strictEqual(upgradedUsageRes.body.runs_limit, 10000);

    // 7. Execution is immediately unthrottled
    const unthrottledRes = await request(app)
      .post('/api/workflows/triggers/manual')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspace.id)
      .send({ workflow_id: workflowId });
    assert.strictEqual(unthrottledRes.status, 200);
  });
});
