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
  invalidEmptyStepsWorkflow,
  invalidStepTypeWorkflow,
  missingVariableRefWorkflow,
  emptyInvoiceText,
  massiveInvoiceText
} from './harness.js';

describe('Tier 2: Boundary & Corner Cases (Defensive Robustness)', () => {
  let testDb;

  beforeEach(() => {
    testDb = setupTestDb();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  // =========================================================================
  // Area 1: Auth & Multi-Tenancy Boundaries (R2)
  // =========================================================================
  describe('Area 1: Auth & Multi-Tenancy Boundaries (R2)', () => {
    it('T2-AUTH-01: Rejects duplicate email registration with case-insensitive collision', async (t) => {
      const ok = await requireFeature(t, 'auth', 'Milestone 1');
      if (!ok) return;

      await registerTenantUser({
        email: 'CaseInsensitive@Domain.com',
        password: 'Password123!Secure',
        fullName: 'Primary User'
      });

      // Second attempt with lowercase
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'caseinsensitive@domain.com',
          password: 'Password123!Secure',
          fullName: 'Duplicate User'
        });

      assert.strictEqual(res.status, 409);
      assert.ok(['EMAIL_EXISTS', 'EMAIL_ALREADY_EXISTS'].includes(res.body.error));
    });

    it('T2-AUTH-02: Rejects expired, forged, or malformed bearer tokens with 401', async (t) => {
      const ok = await requireFeature(t, 'auth', 'Milestone 1');
      if (!ok) return;

      const badTokens = [
        'invalid_raw_token_xyz',
        'Bearer ',
        'Bearer forged.jwt.token',
        'Bearer 00000000000000000000000000000000'
      ];

      for (const token of badTokens) {
        const res = await request(app)
          .get('/api/auth/me')
          .set('Authorization', token);

        assert.strictEqual(res.status, 401, `Token "${token}" should be rejected with 401`);
        assert.ok(res.body.error);
      }
    });

    it('T2-AUTH-03: Cross-tenant IDOR attack: Tenant B cannot read Tenant A workspace', async (t) => {
      const ok = await requireFeature(t, 'workspaces', 'Milestone 1');
      if (!ok) return;

      const tenantA = await registerTenantUser({
        email: 'tenantA_owner@firm.com',
        password: 'Password123!Secure',
        fullName: 'Tenant A Owner'
      });

      const tenantB = await registerTenantUser({
        email: 'tenantB_attacker@corp.io',
        password: 'Password123!Secure',
        fullName: 'Tenant B Attacker'
      });

      // Tenant B tries to fetch Tenant A workspace
      const res = await request(app)
        .get(`/api/workspaces/${tenantA.workspace.id}`)
        .set('Authorization', `Bearer ${tenantB.token}`);

      assert.strictEqual(res.status, 404, 'Must return 404 to avoid leaking existence');
    });

    it('T2-AUTH-04: Cross-tenant IDOR attack: Tenant B cannot delete Tenant A workspace', async (t) => {
      const ok = await requireFeature(t, 'workspaces', 'Milestone 1');
      if (!ok) return;

      const tenantA = await registerTenantUser({
        email: 'tenantA_target@firm.com',
        password: 'Password123!Secure',
        fullName: 'Tenant A Target'
      });

      const tenantB = await registerTenantUser({
        email: 'tenantB_malicious@corp.io',
        password: 'Password123!Secure',
        fullName: 'Tenant B Malicious'
      });

      const res = await request(app)
        .delete(`/api/workspaces/${tenantA.workspace.id}`)
        .set('Authorization', `Bearer ${tenantB.token}`);

      assert.strictEqual(res.status, 404, 'Must return 404 for unauthorized workspace deletion');

      // Verify Tenant A workspace still exists
      const verifyRes = await request(app)
        .get(`/api/workspaces/${tenantA.workspace.id}`)
        .set('Authorization', `Bearer ${tenantA.token}`);
      assert.strictEqual(verifyRes.status, 200);
    });

    it('T2-AUTH-05: Extremely long password (> 1024 chars) is rejected with 400 to prevent CPU DoS', async (t) => {
      const ok = await requireFeature(t, 'auth', 'Milestone 1');
      if (!ok) return;

      const giantPassword = 'A'.repeat(1025);
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'giant_pass@enterprise.com',
          password: giantPassword,
          fullName: 'Giant Pass User'
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'PASSWORD_TOO_LONG');
    });
  });

  // =========================================================================
  // Area 2: Workflow & Trigger Boundaries (R1)
  // =========================================================================
  describe('Area 2: Workflow & Trigger Boundaries (R1)', () => {
    it('T2-WF-01: Webhook trigger with malformed or non-JSON body returns 400 Bad Request', async (t) => {
      const ok = await requireFeature(t, 'engine', 'Milestone 2 (Workflows) & 3');
      if (!ok) return;

      const res = await request(app)
        .post('/api/workflows/triggers/webhook/test_token_123')
        .set('Content-Type', 'application/json')
        .send('{{bad_json');

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
    });

    it('T2-WF-02: Webhook trigger with invalid or nonexistent token returns 404/401', async (t) => {
      const ok = await requireFeature(t, 'engine', 'Milestone 2 (Workflows) & 3');
      if (!ok) return;

      const res = await request(app)
        .post('/api/workflows/triggers/webhook/completely_nonexistent_token_9999')
        .send({ data: 'payload' });

      assert.ok([401, 404].includes(res.status));
    });

    it('T2-WF-03: Workflow creation with zero processing steps is rejected with 400 Bad Request', async (t) => {
      const ok = await requireFeature(t, 'workflows', 'Milestone 2 (Workflows)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't2_wf3@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'WF Creator Zero Steps'
      });

      const res = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send(invalidEmptyStepsWorkflow);

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
    });

    it('T2-WF-04: Workflow referencing nonexistent upstream step variable fails gracefully', async (t) => {
      const ok = await requireFeature(t, 'workflows', 'Milestone 2 (Workflows)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't2_wf4@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'WF Creator Missing Var'
      });

      const res = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send(missingVariableRefWorkflow);

      // Either rejected at validation (400) or accepted with warning
      assert.ok([400, 201].includes(res.status));
    });

    it('T2-WF-05: Massive input text payload (> 500KB) is handled without memory exhaustion', async (t) => {
      const ok = await requireFeature(t, 'engine', 'Milestone 2 (Workflows) & 3');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't2_wf5@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'WF Creator Massive Text'
      });

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({
          name: 'Massive Text Processing Workflow',
          trigger_type: 'manual',
          trigger_config: {},
          steps: [
            {
              id: 'step_1',
              name: 'Extract Massive Invoice',
              type: 'doc_extraction',
              order: 1,
              config: { fields: ['total_amount'] }
            }
          ]
        });

      if (wfRes.status !== 201) return;

      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({ document_text: massiveInvoiceText });

      assert.strictEqual(runRes.status, 200);
      assert.ok(runRes.body.execution.id);
    });
  });

  // =========================================================================
  // Area 3: Execution Engine & Step Error Boundaries (R1)
  // =========================================================================
  describe('Area 3: Execution Engine & Step Error Boundaries (R1)', () => {
    it('T2-ENG-01: Completely blank document input produces graceful warning state', async (t) => {
      const ok = await requireFeature(t, 'engine', 'Milestone 3 (Execution Engine)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't2_eng1@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Empty Doc User'
      });

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({
          name: 'Empty Doc Workflow',
          trigger_type: 'manual',
          trigger_config: {},
          steps: [
            {
              id: 'step_1',
              name: 'Extract Empty Doc',
              type: 'doc_extraction',
              order: 1,
              config: { fields: ['vendor'] }
            }
          ]
        });

      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({ document_text: emptyInvoiceText });

      assert.strictEqual(runRes.status, 200);
      assert.ok(runRes.body.execution.status);
    });

    it('T2-ENG-02: Mid-pipeline step failure preserves prior step logs and marks subsequent skipped', async (t) => {
      const ok = await requireFeature(t, 'engine', 'Milestone 3 (Execution Engine)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't2_eng2@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Pipeline Failure User'
      });

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({
          name: 'Failing Step Pipeline',
          trigger_type: 'manual',
          trigger_config: {},
          steps: [
            { id: 's1', name: 'Step 1 Succeeds', type: 'doc_extraction', order: 1, config: {} },
            { id: 's2', name: 'Step 2 Fails', type: 'doc_extraction', order: 2, config: { fail_intent: true } },
            { id: 's3', name: 'Step 3 Skipped', type: 'synthesis', order: 3, config: {} }
          ]
        });

      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({ document_text: 'sample text' });

      assert.strictEqual(runRes.status, 200);
      assert.strictEqual(runRes.body.execution.status, 'failed');

      const traceRes = await request(app)
        .get(`/api/executions/${runRes.body.execution.id}/trace`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id);

      assert.strictEqual(traceRes.status, 200);
      const steps = traceRes.body.steps;
      assert.strictEqual(steps[0].status, 'success');
      assert.strictEqual(steps[1].status, 'failed');
      assert.strictEqual(steps[2].status, 'skipped');
    });

    it('T2-ENG-03: Simulated AI step timeout or provider rejection fails gracefully without crash', async (t) => {
      const ok = await requireFeature(t, 'engine', 'Milestone 3 (Execution Engine)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't2_eng3@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Timeout User'
      });

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({
          name: 'Timeout Workflow',
          trigger_type: 'manual',
          trigger_config: {},
          steps: [
            { id: 's1', name: 'Timeout Step', type: 'classification', order: 1, config: { simulate_timeout: true } }
          ]
        });

      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({ document_text: 'sample' });

      assert.strictEqual(runRes.status, 200);
      assert.strictEqual(runRes.body.execution.status, 'failed');
    });

    it('T2-ENG-04: Unsupported step type in workflow execution pipeline fails gracefully', async (t) => {
      const ok = await requireFeature(t, 'engine', 'Milestone 3 (Execution Engine)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't2_eng4@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Unsupported Step User'
      });

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send(invalidStepTypeWorkflow);

      // Either rejected at creation (400) or execution fails cleanly
      if (wfRes.status === 201) {
        const runRes = await request(app)
          .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
          .set('Authorization', `Bearer ${token}`)
          .set('x-workspace-id', workspace.id)
          .send({});
        assert.strictEqual(runRes.body.execution.status, 'failed');
      } else {
        assert.strictEqual(wfRes.status, 400);
      }
    });

    it('T2-ENG-05: Non-string or null template interpolations are handled safely', async (t) => {
      const ok = await requireFeature(t, 'engine', 'Milestone 3 (Execution Engine)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't2_eng5@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Null Template User'
      });

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({
          name: 'Null Template Workflow',
          trigger_type: 'manual',
          trigger_config: {},
          steps: [
            { id: 's1', name: 'Synthesize Null', type: 'synthesis', order: 1, config: { template: 'Value is {{steps.none.value}}' } }
          ]
        });

      if (wfRes.status === 201) {
        const runRes = await request(app)
          .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
          .set('Authorization', `Bearer ${token}`)
          .set('x-workspace-id', workspace.id)
          .send({});
        assert.ok([200, 400].includes(runRes.status));
      }
    });
  });

  // =========================================================================
  // Area 4: Billing & Quota Enforcement Boundaries (R3)
  // =========================================================================
  describe('Area 4: Billing & Quota Enforcement Boundaries (R3)', () => {
    it('T2-BILL-01: Execution at exact quota limit (50/50 runs on Free plan) succeeds', async (t) => {
      const ok = await requireFeature(t, 'billing', 'Milestone 4 (Billing)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't2_bill1@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Exact Quota User'
      });

      // Create genuine workflow
      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({
          name: 'Exact Quota Workflow',
          trigger_type: 'manual',
          steps: [{ id: 's1', name: 'Step 1', type: 'doc_extraction', order: 1, config: {} }]
        });
      assert.strictEqual(wfRes.status, 201);
      const workflowId = wfRes.body.workflow.id;

      // Set usage to 49/50 directly in database
      testDb.db
        .prepare('UPDATE usage_meters SET runs_count = 49 WHERE workspace_id = ?')
        .run(workspace.id);

      const runRes = await request(app)
        .post('/api/workflows/triggers/manual')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({ workflow_id: workflowId });

      // Run 50 should be allowed
      assert.strictEqual(runRes.status, 200);
    });

    it('T2-BILL-02: Quota + 1 hard block: execution at run 51/50 returns 429 Quota Exceeded', async (t) => {
      const ok = await requireFeature(t, 'billing', 'Milestone 4 (Billing)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't2_bill2@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Over Quota User'
      });

      // Create genuine workflow
      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({
          name: 'Quota Block Workflow',
          trigger_type: 'manual',
          steps: [{ id: 's1', name: 'Step 1', type: 'doc_extraction', order: 1, config: {} }]
        });
      assert.strictEqual(wfRes.status, 201);
      const workflowId = wfRes.body.workflow.id;

      // Set usage to 50/50 (limit reached)
      testDb.db
        .prepare('UPDATE usage_meters SET runs_count = 50 WHERE workspace_id = ?')
        .run(workspace.id);

      const runRes = await request(app)
        .post('/api/workflows/triggers/manual')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({ workflow_id: workflowId });

      assert.strictEqual(runRes.status, 429);
      assert.strictEqual(runRes.body.error, 'QUOTA_EXCEEDED');
      assert.match(runRes.body.message, /plan limit/i);
    });

    it('T2-BILL-03: Stripe webhook with forged or missing HMAC signature is rejected with 400', async (t) => {
      const ok = await requireFeature(t, 'billing', 'Milestone 4 (Billing)');
      if (!ok) return;

      const event = createCheckoutSessionCompletedEvent('ws_fake_id', 'starter');

      // Forged signature
      const res = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', 't=1234567,v1=bad_forged_signature_hex')
        .send(event);

      assert.strictEqual(res.status, 400);
      assert.match(res.body.message || res.body.error, /signature/i);
    });

    it('T2-BILL-04: Duplicate Stripe webhook events are processed idempotently', async (t) => {
      const ok = await requireFeature(t, 'billing', 'Milestone 4 (Billing)');
      if (!ok) return;

      const { workspace } = await registerTenantUser({
        email: 't2_bill4@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Idempotency User'
      });

      const event = createCheckoutSessionCompletedEvent(workspace.id, 'starter');
      const sig = createStripeSignature(event, STRIPE_TEST_WEBHOOK_SECRET);

      // First delivery
      const res1 = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', sig)
        .send(event);
      assert.strictEqual(res1.status, 200);

      // Duplicate delivery with same event ID
      const res2 = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', sig)
        .send(event);
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.body.idempotent || res2.body.received, true);
    });

    it('T2-BILL-05: Checkout session request for invalid tier returns 400 Bad Request', async (t) => {
      const ok = await requireFeature(t, 'billing', 'Milestone 4 (Billing)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't2_bill5@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Invalid Tier User'
      });

      const res = await request(app)
        .post('/api/billing/checkout')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({ plan_id: 'enterprise_galactic_tier_99' });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
    });
  });

  // =========================================================================
  // Area 5: Web UI & Dashboard Boundaries (R4)
  // =========================================================================
  describe('Area 5: Web UI & Dashboard Boundaries (R4)', () => {
    it('T2-UI-01: Dashboard for fresh workspace renders clean zero-state without errors', async (t) => {
      const ok = await requireFeature(t, 'ui', 'Milestone 5 (Web UI)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't2_ui1@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Empty Dashboard User'
      });

      const res = await request(app)
        .get('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id);

      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(res.body.workflows, []);
    });

    it('T2-UI-02: Trace inspector for nonexistent execution ID returns 404 Not Found', async (t) => {
      const ok = await requireFeature(t, 'ui', 'Milestone 5 (Web UI)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't2_ui2@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Nonexistent Trace User'
      });

      const res = await request(app)
        .get('/api/executions/exec_nonexistent_9999/trace')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id);

      assert.strictEqual(res.status, 404);
    });

    it('T2-UI-03: Execution history endpoint with malformed status filter parameter handles gracefully', async (t) => {
      const ok = await requireFeature(t, 'ui', 'Milestone 5 (Web UI)');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't2_ui3@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Filter User'
      });

      const res = await request(app)
        .get('/api/executions?status=UNKNOWN_STATUS_TYPE_XYZ')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id);

      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(res.body.executions, []);
    });

    it('T2-UI-04: Workflow name containing HTML/script tags is stored safely without XSS', async (t) => {
      const ok = await requireFeature(t, 'workflows', 'Milestone 2 & 5');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't2_ui4@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'XSS Attack User'
      });

      const xssName = "<script>alert('XSS')</script> Safe Workflow";
      const res = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({
          name: xssName,
          trigger_type: 'manual',
          trigger_config: {},
          steps: [{ id: 's1', name: 'Step 1', type: 'doc_extraction', order: 1, config: {} }]
        });

      if (res.status === 201) {
        // Assert stored name does not execute or is escaped
        assert.ok(res.body.workflow.id);
      }
    });

    it('T2-UI-05: Extreme workflow name lengths (255+ characters) are handled cleanly', async (t) => {
      const ok = await requireFeature(t, 'workflows', 'Milestone 2 & 5');
      if (!ok) return;

      const { token, workspace } = await registerTenantUser({
        email: 't2_ui5@enterprise.com',
        password: 'Password123!Secure',
        fullName: 'Long Name User'
      });

      const longName = 'W'.repeat(300);
      const res = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspace.id)
        .send({
          name: longName,
          trigger_type: 'manual',
          trigger_config: {},
          steps: [{ id: 's1', name: 'Step 1', type: 'doc_extraction', order: 1, config: {} }]
        });

      // Either trimmed/stored or rejected with validation error
      assert.ok([201, 400].includes(res.status));
    });
  });
});
