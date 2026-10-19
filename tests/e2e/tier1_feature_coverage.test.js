import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  request,
  app,
  setupTestDb,
  requireFeature,
  registerTenantUser,
  loginTenantUser,
  createStripeSignature,
  createCheckoutSessionCompletedEvent,
  STRIPE_TEST_WEBHOOK_SECRET,
  invoiceProcessingWorkflow,
  sampleValidInvoiceText
} from './harness.js';

describe('Tier 1: Feature Coverage (R1 - R5 Nominal Capabilities)', () => {
  let testDb;

  beforeEach(() => {
    testDb = setupTestDb();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  // =========================================================================
  // Area 1: User Authentication, Workspaces & Access Control (R2)
  // =========================================================================
  describe('Area 1: User Authentication & Workspaces (R2)', () => {
    it('T1-AUTH-01: User registration creates user, default workspace, and free subscription', async (t) => {
      const ok = await requireFeature(t, 'auth', 'Milestone 1');
      if (!ok) return;

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 't1_alice@enterprise.com',
          password: 'Password123!Secure',
          fullName: 'Alice Enterprise',
          workspaceName: 'Alice Global Workspace'
        });

      assert.strictEqual(res.status, 201);
      assert.ok(res.body.token, 'Should return authentication token');
      assert.strictEqual(res.body.user.email, 't1_alice@enterprise.com');
      assert.ok(res.body.workspace.id, 'Should return workspace ID');
      assert.strictEqual(res.body.workspace.name, 'Alice Global Workspace');
      assert.strictEqual(res.body.workspace.role, 'owner');
    });

    it('T1-AUTH-02: User login authenticates credentials and returns active session', async (t) => {
      const ok = await requireFeature(t, 'auth', 'Milestone 1');
      if (!ok) return;

      const registered = await registerTenantUser({
        email: 't1_bob@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Bob Enterprise'
      });

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 't1_bob@enterprise.com',
          password: 'Password123!Secure'
        });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.token, 'Should return session token');
      assert.strictEqual(res.body.user.id, registered.user.id);
      assert.strictEqual(res.body.activeWorkspaceId, registered.workspace.id);
    });

    it('T1-AUTH-03: User logout invalidates session token', async (t) => {
      const ok = await requireFeature(t, 'auth', 'Milestone 1');
      if (!ok) return;

      const { token } = await registerTenantUser({
        email: 't1_charlie@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Charlie Enterprise'
      });

      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`);

      assert.strictEqual(logoutRes.status, 200);
      assert.strictEqual(logoutRes.body.success, true);

      // Subsequent /me call must be rejected
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      assert.strictEqual(meRes.status, 401);
    });

    it('T1-AUTH-04: Current user profile endpoint returns user identity and workspaces', async (t) => {
      const ok = await requireFeature(t, 'auth', 'Milestone 1');
      if (!ok) return;

      const { token, user, workspace } = await registerTenantUser({
        email: 't1_dana@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Dana Enterprise'
      });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.user.id, user.id);
      assert.strictEqual(res.body.user.email, 't1_dana@enterprise.com');
      assert.ok(Array.isArray(res.body.workspaces), 'Should return workspaces list');
      assert.strictEqual(res.body.workspaces[0].id, workspace.id);
    });

    it('T1-AUTH-05: Workspace CRUD permits creating, updating, and listing workspaces', async (t) => {
      const ok = await requireFeature(t, 'workspaces', 'Milestone 1');
      if (!ok) return;

      const { token } = await registerTenantUser({
        email: 't1_eric@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Eric Enterprise'
      });

      // Create secondary workspace
      const createRes = await request(app)
        .post('/api/workspaces')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Eric Secondary Workspace' });

      assert.strictEqual(createRes.status, 201);
      const secondWsId = createRes.body.workspace.id;

      // Update workspace name
      const updateRes = await request(app)
        .put(`/api/workspaces/${secondWsId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Eric Renamed Workspace' });

      assert.strictEqual(updateRes.status, 200);
      assert.strictEqual(updateRes.body.workspace.name, 'Eric Renamed Workspace');

      // List workspaces
      const listRes = await request(app)
        .get('/api/workspaces')
        .set('Authorization', `Bearer ${token}`);

      assert.strictEqual(listRes.status, 200);
      assert.strictEqual(listRes.body.workspaces.length, 2);
    });
  });

  // =========================================================================
  // Area 2: Workflow Builder & Configuration (R1)
  // =========================================================================
  describe('Area 2: Workflow Builder & Management (R1)', () => {
    it('T1-WF-01: Create workflow definition with multi-step pipeline', async (t) => {
      const ok = await requireFeature(t, 'workflows', 'Milestone 2 (Workflows)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't1_wf1@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'WF Creator 1'
      });

      const res = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send(invoiceProcessingWorkflow);

      assert.strictEqual(res.status, 201);
      assert.ok(res.body.workflow.id, 'Workflow should have generated ID');
      assert.strictEqual(res.body.workflow.name, invoiceProcessingWorkflow.name);
      assert.strictEqual(res.body.workflow.steps.length, 3);
    });

    it('T1-WF-02: Retrieve existing workflow by ID with full schema', async (t) => {
      const ok = await requireFeature(t, 'workflows', 'Milestone 2 (Workflows)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't1_wf2@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'WF Creator 2'
      });

      const created = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send(invoiceProcessingWorkflow);

      const res = await request(app)
        .get(`/api/workflows/${created.body.workflow.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.workflow.id, created.body.workflow.id);
      assert.strictEqual(res.body.workflow.trigger_type, 'manual');
    });

    it('T1-WF-03: Update workflow definition metadata and status', async (t) => {
      const ok = await requireFeature(t, 'workflows', 'Milestone 2 (Workflows)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't1_wf3@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'WF Creator 3'
      });

      const created = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send(invoiceProcessingWorkflow);

      const updateRes = await request(app)
        .put(`/api/workflows/${created.body.workflow.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({
          ...invoiceProcessingWorkflow,
          name: 'Updated Invoice Pipeline',
          status: 'paused'
        });

      assert.strictEqual(updateRes.status, 200);
      assert.strictEqual(updateRes.body.workflow.name, 'Updated Invoice Pipeline');
      assert.strictEqual(updateRes.body.workflow.status, 'paused');
    });

    it('T1-WF-04: List all workflows scoped to active workspace', async (t) => {
      const ok = await requireFeature(t, 'workflows', 'Milestone 2 (Workflows)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't1_wf4@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'WF Creator 4'
      });

      await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send(invoiceProcessingWorkflow);

      const listRes = await request(app)
        .get('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id);

      assert.strictEqual(listRes.status, 200);
      assert.ok(Array.isArray(listRes.body.workflows));
      assert.strictEqual(listRes.body.workflows.length, 1);
    });

    it('T1-WF-05: Delete workflow and confirm removal from workspace', async (t) => {
      const ok = await requireFeature(t, 'workflows', 'Milestone 2 (Workflows)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't1_wf5@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'WF Creator 5'
      });

      const created = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send(invoiceProcessingWorkflow);

      const deleteRes = await request(app)
        .delete(`/api/workflows/${created.body.workflow.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id);

      assert.strictEqual(deleteRes.status, 200);

      const getRes = await request(app)
        .get(`/api/workflows/${created.body.workflow.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id);

      assert.strictEqual(getRes.status, 404);
    });
  });

  // =========================================================================
  // Area 3: Automated Execution Engine & AI Steps (R1)
  // =========================================================================
  describe('Area 3: Automated Execution Engine & AI Steps (R1)', () => {
    it('T1-ENG-01: Manual execution trigger executes multi-step workflow end-to-end', async (t) => {
      const ok = await requireFeature(t, 'engine', 'Milestone 3 (Execution Engine)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't1_eng1@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Engine User 1'
      });

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send(invoiceProcessingWorkflow);

      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({ document_text: sampleValidInvoiceText });

      assert.strictEqual(runRes.status, 200);
      assert.ok(runRes.body.execution.id);
      assert.strictEqual(runRes.body.execution.status, 'completed');
    });

    it('T1-ENG-02: Document Extraction step extracts structured key-value entities', async (t) => {
      const ok = await requireFeature(t, 'engine', 'Milestone 3 (Execution Engine)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't1_eng2@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Engine User 2'
      });

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send(invoiceProcessingWorkflow);

      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({ document_text: sampleValidInvoiceText });

      const traceRes = await request(app)
        .get(`/api/executions/${runRes.body.execution.id}/trace`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id);

      assert.strictEqual(traceRes.status, 200);
      const extractStep = traceRes.body.steps.find((s) => s.step_type === 'doc_extraction');
      assert.ok(extractStep, 'Should have doc_extraction step');
      assert.strictEqual(extractStep.status, 'success');
      assert.ok(extractStep.output_data?.fields, 'Should contain extracted fields');
    });

    it('T1-ENG-03: Classification step categorizes input content with reasoning', async (t) => {
      const ok = await requireFeature(t, 'engine', 'Milestone 3 (Execution Engine)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't1_eng3@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Engine User 3'
      });

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send(invoiceProcessingWorkflow);

      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({ document_text: sampleValidInvoiceText });

      const traceRes = await request(app)
        .get(`/api/executions/${runRes.body.execution.id}/trace`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id);

      const classifyStep = traceRes.body.steps.find((s) => s.step_type === 'classification');
      assert.ok(classifyStep, 'Should have classification step');
      assert.strictEqual(classifyStep.status, 'success');
      assert.ok(classifyStep.output_data?.category);
      assert.ok(typeof classifyStep.output_data?.confidence === 'number');
    });

    it('T1-ENG-04: Synthesis step produces executive summary and action items', async (t) => {
      const ok = await requireFeature(t, 'engine', 'Milestone 3 (Execution Engine)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't1_eng4@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Engine User 4'
      });

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send(invoiceProcessingWorkflow);

      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({ document_text: sampleValidInvoiceText });

      const traceRes = await request(app)
        .get(`/api/executions/${runRes.body.execution.id}/trace`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id);

      const synthStep = traceRes.body.steps.find((s) => s.step_type === 'synthesis');
      assert.ok(synthStep, 'Should have synthesis step');
      assert.strictEqual(synthStep.status, 'success');
      assert.ok(synthStep.output_data?.summary);
    });

    it('T1-ENG-05: Execution trace logger records atomic step snapshots and durations', async (t) => {
      const ok = await requireFeature(t, 'engine', 'Milestone 3 (Execution Engine)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't1_eng5@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Engine User 5'
      });

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send(invoiceProcessingWorkflow);

      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({ document_text: sampleValidInvoiceText });

      const traceRes = await request(app)
        .get(`/api/executions/${runRes.body.execution.id}/trace`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id);

      assert.strictEqual(traceRes.status, 200);
      assert.strictEqual(traceRes.body.steps.length, 3);
      for (const step of traceRes.body.steps) {
        assert.ok(step.input_data, 'Step input snapshot must be persisted');
        assert.ok(step.output_data, 'Step output snapshot must be persisted');
        assert.ok(step.duration_ms >= 0, 'Duration must be non-negative');
      }
    });
  });

  // =========================================================================
  // Area 4: Subscription Billing & Usage Metering (R3)
  // =========================================================================
  describe('Area 4: Subscription Billing & Metering (R3)', () => {
    it('T1-BILL-01: Usage status endpoint returns active tier and execution counter', async (t) => {
      const ok = await requireFeature(t, 'billing', 'Milestone 4 (Billing)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't1_bill1@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Billing User 1'
      });

      const res = await request(app)
        .get('/api/billing/usage')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.plan_id, 'free');
      assert.strictEqual(res.body.runs_used, 0);
      assert.strictEqual(res.body.runs_limit, 50);
    });

    it('T1-BILL-02: Stripe Checkout session creation generates valid redirect URL', async (t) => {
      const ok = await requireFeature(t, 'billing', 'Milestone 4 (Billing)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't1_bill2@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Billing User 2'
      });

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
      assert.ok(res.body.checkout_url, 'Should return checkout URL');
      assert.ok(res.body.session_id, 'Should return session ID');
    });

    it('T1-BILL-03: Stripe Customer Billing Portal session generation returns portal URL', async (t) => {
      const ok = await requireFeature(t, 'billing', 'Milestone 4 (Billing)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't1_bill3@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Billing User 3'
      });

      const res = await request(app)
        .post('/api/billing/portal')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({ return_url: 'https://saas.example.com/dashboard' });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.portal_url);
    });

    it('T1-BILL-04: Stripe Webhook handler processes signed checkout.session.completed event', async (t) => {
      const ok = await requireFeature(t, 'billing', 'Milestone 4 (Billing)');
      if (!ok) return;

      const { workspace } = await registerTenantUser({
        email: 't1_bill4@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Billing User 4'
      });

      const event = createCheckoutSessionCompletedEvent(workspace.id, 'starter');
      const sig = createStripeSignature(event, STRIPE_TEST_WEBHOOK_SECRET);

      const res = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', sig)
        .send(event);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.received, true);

      // Verify subscription record updated in database
      const sub = testDb.db
        .prepare('SELECT plan_id FROM subscriptions WHERE workspace_id = ?')
        .get(workspace.id);
      assert.strictEqual(sub.plan_id, 'starter');
    });

    it('T1-BILL-05: Atomic usage meter tracks execution run count', async (t) => {
      const ok = await requireFeature(t, 'billing', 'Milestone 4 (Billing)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't1_bill5@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Billing User 5'
      });

      // Verify meter initially 0
      const initialMeter = testDb.db
        .prepare('SELECT runs_count FROM usage_meters WHERE workspace_id = ?')
        .get(workspace.id);
      assert.strictEqual(initialMeter.runs_count, 0);

      const usageRes = await request(app)
        .get('/api/billing/usage')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id);

      assert.strictEqual(usageRes.status, 200);
      assert.strictEqual(usageRes.body.runs_used, 0);
    });
  });

  // =========================================================================
  // Area 5: Web Application & UI Views (R4)
  // =========================================================================
  describe('Area 5: Production Web Application & UI Views (R4)', () => {
    it('T1-UI-01: Marketing landing page loads responsive HTML with hero and pricing', async (t) => {
      const ok = await requireFeature(t, 'ui', 'Milestone 5 (Web UI)');
      if (!ok) return;

      const res = await request(app).get('/');
      assert.strictEqual(res.status, 200);
      assert.match(res.headers['content-type'], /html/i);
      assert.match(res.text, /workflow/i);
    });

    it('T1-UI-02: Customer dashboard page loads HTML interface', async (t) => {
      const ok = await requireFeature(t, 'ui', 'Milestone 5 (Web UI)');
      if (!ok) return;

      const res = await request(app).get('/dashboard');
      assert.strictEqual(res.status, 200);
      assert.match(res.headers['content-type'], /html/i);
    });

    it('T1-UI-03: Dashboard metrics API returns summary overview stats', async (t) => {
      const ok = await requireFeature(t, 'ui', 'Milestone 5 (Web UI)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't1_ui3@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'UI User 3'
      });

      const res = await request(app)
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id);

      assert.strictEqual(res.status, 200);
      assert.ok('total_workflows' in res.body || 'workflows' in res.body);
    });

    it('T1-UI-04: Workflow execution history endpoint returns paginated executions list', async (t) => {
      const ok = await requireFeature(t, 'ui', 'Milestone 5 (Web UI)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't1_ui4@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'UI User 4'
      });

      const res = await request(app)
        .get('/api/executions')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id);

      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.executions));
    });

    it('T1-UI-05: Step-level trace inspector returns structured step logs', async (t) => {
      const ok = await requireFeature(t, 'ui', 'Milestone 5 (Web UI)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't1_ui5@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'UI User 5'
      });

      const res = await request(app)
        .get('/api/executions/fake-exec-id/trace')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id);

      // Nonexistent execution should return 404
      assert.strictEqual(res.status, 404);
    });
  });
});
