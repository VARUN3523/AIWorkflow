import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../src/app.js';
import { setupTestDb } from '../helpers/test_db.js';

describe('Requirement R4: Production Web Application & Dashboard Integration Tests', () => {
  let testDb;

  beforeEach(() => {
    testDb = setupTestDb();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  async function registerUser(email = 'user_ui@example.com', password = 'Password123!Secure', fullName = 'UI Test User', workspaceName = 'UI Test Workspace') {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password, fullName, workspaceName });

    assert.strictEqual(res.status, 201);
    return {
      user: res.body.user,
      workspace: res.body.workspace,
      token: res.body.token,
      authHeader: `Bearer ${res.body.token}`
    };
  }

  // =========================================================================
  // 1. Marketing Landing Page Tests (Feature F-UI-01)
  // =========================================================================
  describe('Marketing Landing Page (F-UI-01)', () => {
    it('GET / returns 200 HTML with hero, value proposition, demo widget, pricing, and testimonials', async () => {
      const res = await request(app).get('/');

      assert.strictEqual(res.status, 200);
      assert.match(res.headers['content-type'], /html/i);

      // Hero Section assertions
      assert.ok(res.text.includes('FlowAI') || res.text.includes('Flow'), 'Should include brand name');
      assert.ok(res.text.includes('B2B AI Workflow Automation Engine'), 'Should include hero badge');
      assert.ok(res.text.includes('Autonomous AI Pipelines'), 'Should include headline gradient');
      assert.ok(res.text.includes('Start Free Trial'), 'Should include primary CTA');

      // Value Proposition assertions
      assert.ok(res.text.includes('High-Accuracy Document Extraction'), 'Should include doc extraction feature');
      assert.ok(res.text.includes('Multi-Class AI Classification'), 'Should include classification feature');
      assert.ok(res.text.includes('Executive Action Synthesis'), 'Should include synthesis feature');
      assert.ok(res.text.includes('Strict Multi-Tenant Isolation'), 'Should include tenant isolation feature');

      // Live Interactive Demo Widget assertions
      assert.ok(res.text.includes('demo-widget'), 'Should include demo widget container');
      assert.ok(res.text.includes('Run Live Pipeline Simulation'), 'Should include simulate button');
      assert.ok(res.text.includes('AP Vendor Invoice'), 'Should include invoice preset');
      assert.ok(res.text.includes('Enterprise Sales Lead'), 'Should include lead preset');

      // Pipeline Visualization assertions
      assert.ok(res.text.includes('The FlowAI Processing Pipeline'), 'Should include pipeline section');
      assert.ok(res.text.includes('Trigger Ingestion'), 'Should include Phase 1 trigger step');
      assert.ok(res.text.includes('Doc Extraction'), 'Should include Phase 2 extraction step');
      assert.ok(res.text.includes('AI Classification'), 'Should include Phase 3 classification step');
      assert.ok(res.text.includes('Action Synthesis'), 'Should include Phase 4 synthesis step');

      // Pricing Comparison Table assertions
      assert.ok(res.text.includes('Free / Trial'), 'Should include Free tier');
      assert.ok(res.text.includes('Starter'), 'Should include Starter tier');
      assert.ok(res.text.includes('Pro Enterprise'), 'Should include Pro tier');
      assert.ok(res.text.includes('50 workflow runs'), 'Should include free quota');
      assert.ok(res.text.includes('1,000 workflow runs'), 'Should include starter quota');
      assert.ok(res.text.includes('10,000 workflow runs'), 'Should include pro quota');

      // Customer Testimonials assertions
      assert.ok(res.text.includes('Sarah Jenkins'), 'Should include testimonial 1');
      assert.ok(res.text.includes('Marcus Vance'), 'Should include testimonial 2');
      assert.ok(res.text.includes('Elena Rostova'), 'Should include testimonial 3');

      // Scripts & Stylesheets
      assert.ok(res.text.includes('/css/style.css'), 'Should link to style.css');
      assert.ok(res.text.includes('/js/landing.js'), 'Should include landing.js');
    });

    it('GET /marketing serves identical high-converting landing page', async () => {
      const res = await request(app).get('/marketing');

      assert.strictEqual(res.status, 200);
      assert.match(res.headers['content-type'], /html/i);
      assert.ok(res.text.includes('B2B AI Workflow Automation Engine'));
      assert.ok(res.text.includes('demo-widget'));
      assert.ok(res.text.includes('Free / Trial'));
    });
  });

  // =========================================================================
  // 2. Auth Views Tests (Login & Register)
  // =========================================================================
  describe('Authentication Views', () => {
    it('GET /login returns 200 HTML with login form and link to register', async () => {
      const res = await request(app).get('/login');

      assert.strictEqual(res.status, 200);
      assert.match(res.headers['content-type'], /html/i);
      assert.ok(res.text.includes('login-form'), 'Should contain login form');
      assert.ok(res.text.includes('login-email'), 'Should contain email input');
      assert.ok(res.text.includes('login-password'), 'Should contain password input');
      assert.ok(res.text.includes('Start Free Trial'), 'Should link to registration');
      assert.ok(res.text.includes('/js/app.js'), 'Should link to app.js');
    });

    it('GET /register returns 200 HTML with registration form and link to login', async () => {
      const res = await request(app).get('/register');

      assert.strictEqual(res.status, 200);
      assert.match(res.headers['content-type'], /html/i);
      assert.ok(res.text.includes('register-form'), 'Should contain register form');
      assert.ok(res.text.includes('reg-fullname'), 'Should contain full name input');
      assert.ok(res.text.includes('reg-email'), 'Should contain email input');
      assert.ok(res.text.includes('reg-password'), 'Should contain password input');
      assert.ok(res.text.includes('reg-workspace'), 'Should contain workspace input');
      assert.ok(res.text.includes('Sign In'), 'Should link to sign in');
      assert.ok(res.text.includes('/js/app.js'), 'Should link to app.js');
    });
  });

  // =========================================================================
  // 3. Customer Dashboard View Tests (Features F-UI-02 to F-UI-09)
  // =========================================================================
  describe('Interactive Customer Dashboard (F-UI-02 to F-UI-09)', () => {
    it('GET /dashboard returns 200 HTML with KPI cards, workflow management, run modal, and trace inspector', async () => {
      const res = await request(app).get('/dashboard');

      assert.strictEqual(res.status, 200);
      assert.match(res.headers['content-type'], /html/i);

      // F-UI-02: KPI Summary Cards
      assert.ok(res.text.includes('kpi-total-workflows'), 'Should render Total Workflows card');
      assert.ok(res.text.includes('kpi-total-executions'), 'Should render Monthly Executions card');
      assert.ok(res.text.includes('kpi-success-rate'), 'Should render Success Rate card');
      assert.ok(res.text.includes('kpi-quota'), 'Should render Quota Usage card');
      assert.ok(res.text.includes('kpi-quota-fill'), 'Should render Quota progress bar fill');

      // F-UI-03: Workflow Management Container
      assert.ok(res.text.includes('workflows-section'), 'Should render Workflows section');
      assert.ok(res.text.includes('workflows-empty-state'), 'Should render Empty state element');
      assert.ok(res.text.includes('workflows-table-container'), 'Should render Table container element');

      // F-UI-04: Workflow Builder Modal
      assert.ok(res.text.includes('workflow-builder-modal'), 'Should render Workflow Builder modal');
      assert.ok(res.text.includes('workflow-builder-form'), 'Should render Builder form');
      assert.ok(res.text.includes('btn-load-sample-steps'), 'Should render Load Standard Pipeline button');

      // F-UI-05: Interactive Run Modal & Trigger UI
      assert.ok(res.text.includes('run-modal'), 'Should render Run Trigger modal');
      assert.ok(res.text.includes('run-payload-input'), 'Should render payload textarea');
      assert.ok(res.text.includes('trigger-run-btn'), 'Should render Execute Pipeline Now button');

      // F-UI-06: Execution History & Timeline
      assert.ok(res.text.includes('executions-section'), 'Should render Execution History section');
      assert.ok(res.text.includes('executions-empty-state'), 'Should render executions empty state');
      assert.ok(res.text.includes('executions-table'), 'Should render Executions table');

      // F-UI-07: Step-Level Trace Inspector
      assert.ok(res.text.includes('trace-modal'), 'Should render Trace Inspector modal');
      assert.ok(res.text.includes('trace-execution-id'), 'Should render Execution ID badge in trace');
      assert.ok(res.text.includes('trace-steps-container'), 'Should render steps accordions container');

      // F-UI-09: Account & Billing Management UI
      assert.ok(res.text.includes('billing-summary-card'), 'Should render Billing summary card');
      assert.ok(res.text.includes('btn-stripe-portal'), 'Should render Stripe Customer Portal button');
      assert.ok(res.text.includes('btn-upgrade-checkout'), 'Should render Upgrade Checkout button');

      // Client script inclusion
      assert.ok(res.text.includes('/js/app.js'), 'Should include app.js');
    });

    it('GET /dashboard.html returns 200 HTML for compatibility', async () => {
      const res = await request(app).get('/dashboard.html');
      assert.strictEqual(res.status, 200);
      assert.match(res.headers['content-type'], /html/i);
      assert.ok(res.text.includes('kpi-total-workflows'));
    });
  });

  // =========================================================================
  // 4. Static Assets Delivery Tests
  // =========================================================================
  describe('Static Assets Delivery', () => {
    it('GET /css/style.css serves responsive stylesheet', async () => {
      const res = await request(app).get('/css/style.css');

      assert.strictEqual(res.status, 200);
      assert.match(res.headers['content-type'], /css/i);
      assert.ok(res.text.includes('.hero-section'), 'Should define hero styles');
      assert.ok(res.text.includes('.kpi-card'), 'Should define KPI card styles');
      assert.ok(res.text.includes('.modal-backdrop'), 'Should define modal styles');
      assert.ok(res.text.includes('@media (max-width:'), 'Should define responsive breakpoints');
    });

    it('GET /js/landing.js serves landing page script', async () => {
      const res = await request(app).get('/js/landing.js');

      assert.strictEqual(res.status, 200);
      assert.match(res.headers['content-type'], /javascript/i);
      assert.ok(res.text.includes('DEMO_PRESETS'), 'Should define demo presets');
      assert.ok(res.text.includes('demo-simulate-btn'), 'Should handle simulation button');
    });

    it('GET /js/app.js serves dashboard application script', async () => {
      const res = await request(app).get('/js/app.js');

      assert.strictEqual(res.status, 200);
      assert.match(res.headers['content-type'], /javascript/i);
      assert.ok(res.text.includes('fetchDashboardStats'), 'Should implement stats fetching');
      assert.ok(res.text.includes('fetchWorkflows'), 'Should implement workflows fetching');
      assert.ok(res.text.includes('openTraceModal'), 'Should implement trace inspector');
    });
  });

  // =========================================================================
  // 5. Dashboard Stats API Tests (GET /api/dashboard/stats)
  // =========================================================================
  describe('Dashboard Metrics API (GET /api/dashboard/stats)', () => {
    it('Unauthenticated request to /api/dashboard/stats returns 401 Unauthorized', async () => {
      const res = await request(app).get('/api/dashboard/stats');
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, 'UNAUTHORIZED');
    });

    it('Authenticated request returns initial zero metrics for brand new workspace', async () => {
      const { authHeader, workspace } = await registerUser('stats_user@example.com');

      const res = await request(app)
        .get('/api/dashboard/stats')
        .set('Authorization', authHeader)
        .set('x-workspace-id', workspace.id);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.total_workflows, 0);
      assert.strictEqual(res.body.workflows, 0);
      assert.strictEqual(res.body.active_workflows, 0);
      assert.strictEqual(res.body.total_executions, 0);
      assert.strictEqual(res.body.completed_executions, 0);
      assert.strictEqual(res.body.failed_executions, 0);
      assert.strictEqual(res.body.success_rate, 100);
      assert.strictEqual(res.body.runs_used, 0);
      assert.strictEqual(res.body.runs_limit, 50);
      assert.strictEqual(res.body.plan_id, 'free');
      assert.strictEqual(res.body.quota_percentage, 0);
    });

    it('Enforces strict tenant isolation: Tenant B cannot see Tenant A stats', async () => {
      const tenantA = await registerUser('tenant_a@example.com', 'Pass123!Secure', 'User A', 'Workspace A');
      const tenantB = await registerUser('tenant_b@example.com', 'Pass123!Secure', 'User B', 'Workspace B');

      // Tenant A creates 1 workflow
      await request(app)
        .post('/api/workflows')
        .set('Authorization', tenantA.authHeader)
        .set('x-workspace-id', tenantA.workspace.id)
        .send({
          name: 'Tenant A Secret Workflow',
          trigger_type: 'manual',
          steps: [
            { id: 's1', name: 'Extract', type: 'doc_extraction', order: 1 }
          ]
        });

      // Tenant B queries stats
      const statsB = await request(app)
        .get('/api/dashboard/stats')
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantB.workspace.id);

      assert.strictEqual(statsB.status, 200);
      assert.strictEqual(statsB.body.total_workflows, 0, 'Tenant B must see 0 workflows');

      // Tenant A queries stats
      const statsA = await request(app)
        .get('/api/dashboard/stats')
        .set('Authorization', tenantA.authHeader)
        .set('x-workspace-id', tenantA.workspace.id);

      assert.strictEqual(statsA.status, 200);
      assert.strictEqual(statsA.body.total_workflows, 1, 'Tenant A must see 1 workflow');
    });
  });

  // =========================================================================
  // 6. End-to-End User Journey (Acceptance Criteria line 42)
  // "End-to-end tests verify that the web dashboard loads, displays workflows, and permits triggering an execution."
  // =========================================================================
  describe('End-to-End Dashboard Journey (Acceptance Criteria line 42)', () => {
    it('Complete user journey: Register -> Create 3-step workflow -> View Dashboard -> Run execution -> Inspect Step Trace', async () => {
      // 1. Register new user
      const { user, workspace, authHeader } = await registerUser(
        'e2e_journey_user@enterprise.com',
        'SecurePassword999!',
        'Jordan Chase',
        'Chase Logistics Inc'
      );
      assert.ok(user.id);
      assert.ok(workspace.id);

      // 2. Load dashboard HTML view
      const dashboardHtmlRes = await request(app).get('/dashboard');
      assert.strictEqual(dashboardHtmlRes.status, 200);
      assert.ok(dashboardHtmlRes.text.includes('Configured Workflows'));

      // 3. Create a 3-step AI workflow (Doc Extraction -> Classification -> Synthesis)
      const createWfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', authHeader)
        .set('x-workspace-id', workspace.id)
        .send({
          name: 'AP Vendor Invoice Automated Pipeline',
          description: 'Extracts invoices, scores expense level, and generates CFO approval brief',
          trigger_type: 'manual',
          steps: [
            {
              id: 'step_extract',
              name: 'Invoice Entity Extraction',
              type: 'doc_extraction',
              order: 1,
              config: { fields: ['invoice_number', 'vendor_name', 'total_amount'] }
            },
            {
              id: 'step_classify',
              name: 'Expense Classification',
              type: 'classification',
              order: 2,
              config: {
                input: '{{steps.step_extract.output.fields.total_amount}}',
                categories: ['Low Expense (<$500)', 'Standard Expense ($500-$5k)', 'High-Value Enterprise Expense (>$5k)']
              }
            },
            {
              id: 'step_synth',
              name: 'CFO Action Brief Synthesis',
              type: 'synthesis',
              order: 3,
              config: {
                prompt: 'Summarize invoice and routing recommendations',
                format: 'markdown'
              }
            }
          ]
        });

      assert.strictEqual(createWfRes.status, 201);
      const workflow = createWfRes.body.workflow;
      assert.ok(workflow.id);
      assert.strictEqual(workflow.name, 'AP Vendor Invoice Automated Pipeline');
      assert.strictEqual(workflow.steps.length, 3);

      // 4. Query workflows list (verifying dashboard table population)
      const listWfRes = await request(app)
        .get('/api/workflows')
        .set('Authorization', authHeader)
        .set('x-workspace-id', workspace.id);

      assert.strictEqual(listWfRes.status, 200);
      assert.strictEqual(listWfRes.body.workflows.length, 1);
      assert.strictEqual(listWfRes.body.workflows[0].id, workflow.id);

      // 5. Check updated dashboard stats (1 workflow, 0 executions)
      const statsBeforeRun = await request(app)
        .get('/api/dashboard/stats')
        .set('Authorization', authHeader)
        .set('x-workspace-id', workspace.id);

      assert.strictEqual(statsBeforeRun.status, 200);
      assert.strictEqual(statsBeforeRun.body.total_workflows, 1);
      assert.strictEqual(statsBeforeRun.body.total_executions, 0);

      // 6. Trigger execution via POST /api/workflows/:id/run with realistic invoice payload
      const invoicePayload = `INVOICE #INV-2026-7788
Vendor: Global Cloud Servers Corp.
Total Amount: $12,500.00
Payment Terms: Net 30
Line Items: High-Performance GPU Cluster (Month of October 2026)`;

      const runRes = await request(app)
        .post(`/api/workflows/${workflow.id}/run`)
        .set('Authorization', authHeader)
        .set('x-workspace-id', workspace.id)
        .send({ payload: { text: invoicePayload } });

      assert.strictEqual(runRes.status, 200);
      assert.ok(runRes.body.execution_id, 'Should return execution_id');
      assert.strictEqual(runRes.body.status, 'completed', 'Execution should complete cleanly');
      assert.ok(runRes.body.duration_ms >= 0, 'Should record duration');

      const executionId = runRes.body.execution_id;

      // 7. Verify step-level trace inspector endpoint (GET /api/executions/:id/trace)
      const traceRes = await request(app)
        .get(`/api/executions/${executionId}/trace`)
        .set('Authorization', authHeader)
        .set('x-workspace-id', workspace.id);

      assert.strictEqual(traceRes.status, 200);
      assert.ok(traceRes.body.execution);
      assert.strictEqual(traceRes.body.execution.id, executionId);
      assert.strictEqual(traceRes.body.execution.status, 'completed');

      // Verify all 3 steps recorded immutable snapshots
      const steps = traceRes.body.steps;
      assert.strictEqual(steps.length, 3, 'Should persist exactly 3 step logs');

      // Step 1: doc_extraction
      assert.strictEqual(steps[0].step_type, 'doc_extraction');
      assert.strictEqual(steps[0].status, 'success');
      assert.ok(steps[0].output_data);

      // Step 2: classification
      assert.strictEqual(steps[1].step_type, 'classification');
      assert.strictEqual(steps[1].status, 'success');
      assert.ok(steps[1].output_data);

      // Step 3: synthesis
      assert.strictEqual(steps[2].step_type, 'synthesis');
      assert.strictEqual(steps[2].status, 'success');
      assert.ok(steps[2].output_data);

      // 8. Verify dashboard stats updated with execution metrics
      const statsAfterRun = await request(app)
        .get('/api/dashboard/stats')
        .set('Authorization', authHeader)
        .set('x-workspace-id', workspace.id);

      assert.strictEqual(statsAfterRun.status, 200);
      assert.strictEqual(statsAfterRun.body.total_workflows, 1);
      assert.strictEqual(statsAfterRun.body.total_executions, 1);
      assert.strictEqual(statsAfterRun.body.completed_executions, 1);
      assert.strictEqual(statsAfterRun.body.failed_executions, 0);
      assert.strictEqual(statsAfterRun.body.success_rate, 100);
      assert.strictEqual(statsAfterRun.body.runs_used, 1);

      // 9. Verify executions list endpoint
      const listExecRes = await request(app)
        .get('/api/executions')
        .set('Authorization', authHeader)
        .set('x-workspace-id', workspace.id);

      assert.strictEqual(listExecRes.status, 200);
      assert.strictEqual(listExecRes.body.executions.length, 1);
      assert.strictEqual(listExecRes.body.executions[0].id, executionId);
    });

    it('Handles graceful step failure in execution trace without breaking dashboard stats', async () => {
      const { workspace, authHeader } = await registerUser('failing_flow@test.com');

      // Create workflow with a step that will fail gracefully or record error
      const createWfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', authHeader)
        .set('x-workspace-id', workspace.id)
        .send({
          name: 'Fragile Pipeline',
          trigger_type: 'manual',
          steps: [
            {
              id: 'step_extract',
              name: 'Extraction',
              type: 'doc_extraction',
              order: 1
            }
          ]
        });

      assert.strictEqual(createWfRes.status, 201);
      const workflowId = createWfRes.body.workflow.id;

      // Run with normal text
      const runRes = await request(app)
        .post(`/api/workflows/${workflowId}/run`)
        .set('Authorization', authHeader)
        .set('x-workspace-id', workspace.id)
        .send({ payload: { text: 'Empty or standard text' } });

      assert.strictEqual(runRes.status, 200);

      const stats = await request(app)
        .get('/api/dashboard/stats')
        .set('Authorization', authHeader)
        .set('x-workspace-id', workspace.id);

      assert.strictEqual(stats.status, 200);
      assert.strictEqual(stats.body.total_executions, 1);
    });
  });

  // =========================================================================
  // 7. Security & XSS Sanitization Tests
  // =========================================================================
  describe('Security & XSS Defense', () => {
    it('Workflow names containing malicious HTML/script tags are stored safely and not executed', async () => {
      const { workspace, authHeader } = await registerUser('xss_test@test.com');

      const maliciousName = '<script>alert("xss")</script> Clean Workflow';
      const createRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', authHeader)
        .set('x-workspace-id', workspace.id)
        .send({
          name: maliciousName,
          trigger_type: 'manual',
          steps: [{ id: 's1', name: 'Step 1', type: 'doc_extraction', order: 1 }]
        });

      assert.strictEqual(createRes.status, 201);

      // Verify list endpoint returns escaped or plain text
      const listRes = await request(app)
        .get('/api/workflows')
        .set('Authorization', authHeader)
        .set('x-workspace-id', workspace.id);

      assert.strictEqual(listRes.status, 200);
      assert.strictEqual(listRes.body.workflows[0].name, maliciousName);

      // Verify dashboard view doesn't break
      const dashRes = await request(app).get('/dashboard');
      assert.strictEqual(dashRes.status, 200);
    });
  });
});
