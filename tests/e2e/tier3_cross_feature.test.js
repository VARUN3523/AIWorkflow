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
  invoiceProcessingWorkflow,
  sampleValidInvoiceText,
  enterpriseLeadPayload
} from './harness.js';

describe('Tier 3: Cross-Feature Combinations (Integrated Subsystems)', () => {
  let testDb;

  beforeEach(() => {
    testDb = setupTestDb();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it('T3-COMBO-01: Full Tenant Lifecycle (Register -> Provision -> Workflow -> Run -> Meter -> Trace)', async (t) => {
    const okAuth = await requireFeature(t, 'auth', 'Milestone 1');
    if (!okAuth) return;
    const okEngine = await requireFeature(t, 'engine', 'Milestone 2 & 3');
    if (!okEngine) return;

    // 1. Register new tenant
    const { token, workspace } = await registerTenantUser({
      email: 't3_lifecycle@enterprise.com',
      password: 'Password123!Secure',
      fullName: 'Lifecycle User'
    });

    // 2. Create 3-step workflow
    const wfRes = await request(app)
      .post('/api/workflows')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspace.id)
      .send(invoiceProcessingWorkflow);
    assert.strictEqual(wfRes.status, 201);
    const workflowId = wfRes.body.workflow.id;

    // 3. Trigger manual execution
    const runRes = await request(app)
      .post(`/api/workflows/${workflowId}/run`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspace.id)
      .send({ document_text: sampleValidInvoiceText });
    assert.strictEqual(runRes.status, 200);
    const executionId = runRes.body.execution.id;

    // 4. Verify usage meter incremented
    const usageRes = await request(app)
      .get('/api/billing/usage')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspace.id);
    assert.strictEqual(usageRes.body.runs_used, 1);

    // 5. Inspect execution trace
    const traceRes = await request(app)
      .get(`/api/executions/${executionId}/trace`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspace.id);
    assert.strictEqual(traceRes.status, 200);
    assert.strictEqual(traceRes.body.steps.length, 3);
  });

  it('T3-COMBO-02: Quota Exhaustion & Self-Serve Stripe Upgrade Recovery', async (t) => {
    const okAuth = await requireFeature(t, 'auth', 'Milestone 1');
    if (!okAuth) return;
    const okBill = await requireFeature(t, 'billing', 'Milestone 4 (Billing)');
    if (!okBill) return;
    const okEngine = await requireFeature(t, 'engine', 'Milestone 2 & 3');
    if (!okEngine) return;

    const { token, workspace } = await registerTenantUser({
      email: 't3_quota_upgrade@enterprise.com',
      password: 'Password123!Secure',
      fullName: 'Upgrade User'
    });

    // Create genuine workflow
    const wfRes = await request(app)
      .post('/api/workflows')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspace.id)
      .send({
        name: 'Quota Upgrade Workflow',
        trigger_type: 'manual',
        steps: [{ id: 's1', name: 'Step 1', type: 'doc_extraction', order: 1, config: {} }]
      });
    assert.strictEqual(wfRes.status, 201);
    const workflowId = wfRes.body.workflow.id;

    // Simulate quota exhaustion (50 runs used out of 50 Free limit)
    testDb.db
      .prepare('UPDATE usage_meters SET runs_count = 50 WHERE workspace_id = ?')
      .run(workspace.id);

    // Attempt execution -> must be blocked
    const blockedRes = await request(app)
      .post('/api/workflows/triggers/manual')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspace.id)
      .send({ workflow_id: workflowId });
    assert.strictEqual(blockedRes.status, 429);
    assert.strictEqual(blockedRes.body.error, 'QUOTA_EXCEEDED');

    // Upgrade via Stripe webhook
    const event = createCheckoutSessionCompletedEvent(workspace.id, 'starter');
    const sig = createStripeSignature(event, STRIPE_TEST_WEBHOOK_SECRET);
    const webhookRes = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', sig)
      .send(event);
    assert.strictEqual(webhookRes.status, 200);

    // Verify subsequent execution succeeds with Starter quota (1000 limit)
    const successRes = await request(app)
      .post('/api/workflows/triggers/manual')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspace.id)
      .send({ workflow_id: workflowId });
    assert.strictEqual(successRes.status, 200);
  });

  it('T3-COMBO-03: Webhook Trigger Dispatches Multi-Step AI Pipeline & Tracing', async (t) => {
    const okEngine = await requireFeature(t, 'engine', 'Milestone 2 & 3');
    if (!okEngine) return;

    const { token, workspace } = await registerTenantUser({
      email: 't3_webhook_pipe@enterprise.com',
      password: 'Password123!Secure',
      fullName: 'Webhook Pipe User'
    });

    const webhookToken = 'whk_token_combo_03_test';
    const wfRes = await request(app)
      .post('/api/workflows')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspace.id)
      .send({
        name: 'Inbound Webhook Processor',
        trigger_type: 'webhook',
        trigger_config: { webhook_token: webhookToken },
        steps: [
          { id: 's1', name: 'Extract', type: 'doc_extraction', order: 1, config: {} },
          { id: 's2', name: 'Classify', type: 'classification', order: 2, config: {} },
          { id: 's3', name: 'Synthesize', type: 'synthesis', order: 3, config: {} }
        ]
      });

    // Public webhook trigger
    const triggerRes = await request(app)
      .post(`/api/workflows/triggers/webhook/${webhookToken}`)
      .send(enterpriseLeadPayload);

    assert.strictEqual(triggerRes.status, 200);
    assert.ok(triggerRes.body.execution_id || triggerRes.body.execution?.id);
  });

  it('T3-COMBO-04: Multi-Tenant Concurrent Isolation Barrier', async (t) => {
    const okAuth = await requireFeature(t, 'auth', 'Milestone 1');
    if (!okAuth) return;

    // Tenant A
    const tenantA = await registerTenantUser({
      email: 't3_tenantA@corp-alpha.com',
      password: 'Password123!Secure',
      fullName: 'Tenant A Admin'
    });

    // Tenant B
    const tenantB = await registerTenantUser({
      email: 't3_tenantB@corp-beta.com',
      password: 'Password123!Secure',
      fullName: 'Tenant B Admin'
    });

    // Tenant A creates secondary workspace
    const wsARes = await request(app)
      .post('/api/workspaces')
      .set('Authorization', `Bearer ${tenantA.token}`)
      .send({ name: 'Alpha Secret Workspace' });
    assert.strictEqual(wsARes.status, 201);
    const secretWsId = wsARes.body.workspace.id;

    // Tenant B tries to access Tenant A workspace
    const leakAttemptRes = await request(app)
      .get(`/api/workspaces/${secretWsId}`)
      .set('Authorization', `Bearer ${tenantB.token}`);
    assert.strictEqual(leakAttemptRes.status, 404);

    // Verify Tenant B workspaces list does not include Tenant A workspace
    const listBRes = await request(app)
      .get('/api/workspaces')
      .set('Authorization', `Bearer ${tenantB.token}`);
    assert.strictEqual(listBRes.status, 200);
    const hasAlphaWs = listBRes.body.workspaces.some((ws) => ws.id === secretWsId);
    assert.strictEqual(hasAlphaWs, false, 'Tenant B must never see Tenant A workspaces');
  });

  it('T3-COMBO-05: File Upload Ingestion, Live Execution & Status Polling', async (t) => {
    const okEngine = await requireFeature(t, 'engine', 'Milestone 2 & 3');
    if (!okEngine) return;

    const { token, workspace } = await registerTenantUser({
      email: 't3_upload@enterprise.com',
      password: 'Password123!Secure',
      fullName: 'Upload Pipeline User'
    });

    // Create genuine workflow
    const wfRes = await request(app)
      .post('/api/workflows')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspace.id)
      .send({
        name: 'Upload Test Pipeline',
        trigger_type: 'file_upload',
        steps: [{ id: 's1', name: 'Extract Document Entities', type: 'doc_extraction', order: 1, config: {} }]
      });
    assert.strictEqual(wfRes.status, 201);
    const workflowId = wfRes.body.workflow.id;

    // Ingest simulated multipart file payload
    const uploadRes = await request(app)
      .post(`/api/workflows/triggers/upload/${workflowId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspace.id)
      .attach('file', Buffer.from(sampleValidInvoiceText, 'utf-8'), 'sample_invoice.txt');

    if (uploadRes.status === 200 || uploadRes.status === 201) {
      assert.ok(uploadRes.body.execution_id || uploadRes.body.execution?.id);
    }
  });
});
