import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../src/app.js';
import { setupTestDb } from '../helpers/test_db.js';
import { createStripeSignature, STRIPE_TEST_WEBHOOK_SECRET, createCheckoutSessionCompletedEvent } from '../fixtures/stripe.js';
import { mockExtractEntities } from '../../src/steps/mock_ai.js';
import { TraceLogger } from '../../src/engine/logger.js';
import { checkAndIncrementQuota } from '../../src/billing/service.js';

describe('Security Audit Fixes Verification Suite (All Findings C-1 to Hygiene)', () => {
  let testDb;

  beforeEach(() => {
    testDb = setupTestDb();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  async function registerUser(email, fullName = 'Test User', wsName = 'Test WS') {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email,
        password: 'Password123!',
        fullName,
        workspaceName: wsName,
      });
    return {
      token: res.body.token,
      user: res.body.user,
      workspace: res.body.workspace,
    };
  }

  // 1. C-1 / P1: Stripe Webhook Secret Fallback Remediation
  describe('C-1 / P1: Hardcoded Stripe Webhook Secret Fallback Remediation', () => {
    it('rejects Stripe webhook with 500 WEBHOOK_SECRET_NOT_CONFIGURED when in non-test mode and secret is unset', async () => {
      const origNodeEnv = process.env.NODE_ENV;
      const origSecret = process.env.STRIPE_WEBHOOK_SECRET;
      delete process.env.STRIPE_WEBHOOK_SECRET;
      process.env.NODE_ENV = 'production';

      try {
        const event = createCheckoutSessionCompletedEvent('ws_dummy_123');
        const sig = createStripeSignature(event, STRIPE_TEST_WEBHOOK_SECRET);

        const res = await request(app)
          .post('/api/webhooks/stripe')
          .set('stripe-signature', sig)
          .send(event);

        assert.strictEqual(res.status, 500);
        assert.strictEqual(res.body.error, 'WEBHOOK_SECRET_NOT_CONFIGURED');
      } finally {
        process.env.NODE_ENV = origNodeEnv;
        if (origSecret) process.env.STRIPE_WEBHOOK_SECRET = origSecret;
      }
    });

    it('rejects forged signature in test mode with 400 INVALID_SIGNATURE', async () => {
      const event = createCheckoutSessionCompletedEvent('ws_dummy_123');
      const forgedSig = 't=123456789,v1=bad_signature_value';

      const res = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', forgedSig)
        .send(event);

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'INVALID_SIGNATURE');
    });
  });

  // 2. H-1 / P2: Workflow Routes RBAC Enforcement
  describe('H-1 / P2: RBAC Enforcement on Workflow Routes', () => {
    it('blocks viewer role from creating, modifying, and deleting workflows (403 INSUFFICIENT_PERMISSIONS)', async () => {
      const owner = await registerUser('owner_wf@corp.com', 'Owner', 'Corp WS');
      const viewer = await registerUser('viewer_wf@corp.com', 'Viewer', 'Viewer WS');

      // Add viewer to Corp WS with role 'viewer'
      const addRes = await request(app)
        .post(`/api/workspaces/${owner.workspace.id}/members`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ email: viewer.user.email, role: 'viewer' });
      assert.strictEqual(addRes.status, 201);

      // Owner creates a workflow
      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${owner.token}`)
        .set('x-workspace-id', owner.workspace.id)
        .send({
          name: 'Owner Workflow',
          steps: [{ id: 's1', name: 'Step 1', type: 'doc_extraction', order: 1 }]
        });
      assert.strictEqual(wfRes.status, 201);
      const wfId = wfRes.body.workflow.id;

      // 1. Viewer attempts POST /api/workflows -> 403
      const createRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${viewer.token}`)
        .set('x-workspace-id', owner.workspace.id)
        .send({
          name: 'Viewer Malicious Workflow',
          steps: [{ id: 's1', name: 'Step 1', type: 'doc_extraction', order: 1 }]
        });
      assert.strictEqual(createRes.status, 403);
      assert.strictEqual(createRes.body.error, 'INSUFFICIENT_PERMISSIONS');

      // 2. Viewer attempts PUT /api/workflows/:id -> 403
      const putRes = await request(app)
        .put(`/api/workflows/${wfId}`)
        .set('Authorization', `Bearer ${viewer.token}`)
        .set('x-workspace-id', owner.workspace.id)
        .send({ name: 'Tampered by Viewer' });
      assert.strictEqual(putRes.status, 403);
      assert.strictEqual(putRes.body.error, 'INSUFFICIENT_PERMISSIONS');

      // 3. Viewer attempts DELETE /api/workflows/:id -> 403
      const delRes = await request(app)
        .delete(`/api/workflows/${wfId}`)
        .set('Authorization', `Bearer ${viewer.token}`)
        .set('x-workspace-id', owner.workspace.id);
      assert.strictEqual(delRes.status, 403);
      assert.strictEqual(delRes.body.error, 'INSUFFICIENT_PERMISSIONS');

      // 4. Viewer attempts POST /api/workflows/:id/run -> 403
      const runRes = await request(app)
        .post(`/api/workflows/${wfId}/run`)
        .set('Authorization', `Bearer ${viewer.token}`)
        .set('x-workspace-id', owner.workspace.id)
        .send({ payload: 'test' });
      assert.strictEqual(runRes.status, 403);
      assert.strictEqual(runRes.body.error, 'INSUFFICIENT_PERMISSIONS');

      // 5. Viewer attempts POST /api/workflows/triggers/manual -> 403
      const manualRes = await request(app)
        .post('/api/workflows/triggers/manual')
        .set('Authorization', `Bearer ${viewer.token}`)
        .set('x-workspace-id', owner.workspace.id)
        .send({ workflow_id: wfId, payload: 'test' });
      assert.strictEqual(manualRes.status, 403);
      assert.strictEqual(manualRes.body.error, 'INSUFFICIENT_PERMISSIONS');
    });

    it('permits member role to execute workflows but not create/delete them', async () => {
      const owner = await registerUser('owner_wf_member@corp.com', 'Owner', 'Corp WS Member');
      const member = await registerUser('member_wf@corp.com', 'Member', 'Member WS');

      // Add member to Corp WS with role 'member'
      await request(app)
        .post(`/api/workspaces/${owner.workspace.id}/members`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ email: member.user.email, role: 'member' });

      // Owner creates workflow
      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${owner.token}`)
        .set('x-workspace-id', owner.workspace.id)
        .send({
          name: 'Member Runnable Workflow',
          steps: [{ id: 's1', name: 'Step 1', type: 'doc_extraction', order: 1 }]
        });
      assert.strictEqual(wfRes.status, 201);
      const wfId = wfRes.body.workflow.id;

      // Member cannot delete workflow (403)
      const delRes = await request(app)
        .delete(`/api/workflows/${wfId}`)
        .set('Authorization', `Bearer ${member.token}`)
        .set('x-workspace-id', owner.workspace.id);
      assert.strictEqual(delRes.status, 403);

      // Member can run workflow (200)
      const runRes = await request(app)
        .post(`/api/workflows/${wfId}/run`)
        .set('Authorization', `Bearer ${member.token}`)
        .set('x-workspace-id', owner.workspace.id)
        .send({ payload: 'Run by member' });
      assert.strictEqual(runRes.status, 200);
      assert.ok(runRes.body.execution_id);
    });
  });

  // 3. H-2 / P4: ReDoS in doc_extraction fields
  describe('H-2 / P4: ReDoS Vulnerability Defense', () => {
    it('safely evaluates doc_extraction with adversarial regex metacharacters without backtracking lockup', async () => {
      const maliciousFields = [
        '(a+)+$',
        '([a-zA-Z]+)*',
        '(x+x+)+y',
        'a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?aaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'Invoice#.*[0-9]+'
      ];

      const testText = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa\nInvoice# 12345\nTotal: $500.00';

      const startTime = Date.now();
      const result = await mockExtractEntities(testText, maliciousFields);
      const durationMs = Date.now() - startTime;

      // Must complete in under 100ms without catastrophic backtracking
      assert.ok(durationMs < 100, `ReDoS extraction took too long: ${durationMs}ms`);
      assert.ok(result);
      assert.ok(result.fields);
    });
  });

  // 4. M-6 / P3: Webhook trigger tokens hidden from viewer role
  describe('M-6 / P3: Webhook Trigger Token Redaction for Viewer Role', () => {
    it('masks webhook_token as whsec_**** for viewer role on GET /api/workflows and GET /api/workflows/:id', async () => {
      const owner = await registerUser('token_owner@corp.com', 'Token Owner', 'Token WS');
      const viewer = await registerUser('token_viewer@corp.com', 'Token Viewer', 'Viewer Token WS');

      await request(app)
        .post(`/api/workspaces/${owner.workspace.id}/members`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ email: viewer.user.email, role: 'viewer' });

      const realSecretToken = 'whsec_secret_production_webhook_token_99999';

      // Create workflow with webhook trigger
      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${owner.token}`)
        .set('x-workspace-id', owner.workspace.id)
        .send({
          name: 'Webhook Trigger Workflow',
          trigger_type: 'webhook',
          trigger_config: { webhook_token: realSecretToken },
          steps: [{ id: 's1', name: 'Step 1', type: 'doc_extraction', order: 1 }]
        });
      assert.strictEqual(wfRes.status, 201);
      const wfId = wfRes.body.workflow.id;

      // 1. Owner GET by ID -> receives unmasked token
      const ownerGetRes = await request(app)
        .get(`/api/workflows/${wfId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .set('x-workspace-id', owner.workspace.id);
      assert.strictEqual(ownerGetRes.status, 200);
      assert.strictEqual(ownerGetRes.body.workflow.trigger_config.webhook_token, realSecretToken);

      // 2. Viewer GET by ID -> receives masked token
      const viewerGetRes = await request(app)
        .get(`/api/workflows/${wfId}`)
        .set('Authorization', `Bearer ${viewer.token}`)
        .set('x-workspace-id', owner.workspace.id);
      assert.strictEqual(viewerGetRes.status, 200);
      assert.strictEqual(viewerGetRes.body.workflow.trigger_config.webhook_token, 'whsec_****');

      // 3. Viewer GET list -> receives masked token
      const viewerListRes = await request(app)
        .get('/api/workflows')
        .set('Authorization', `Bearer ${viewer.token}`)
        .set('x-workspace-id', owner.workspace.id);
      assert.strictEqual(viewerListRes.status, 200);
      const matched = viewerListRes.body.workflows.find(w => w.id === wfId);
      assert.ok(matched);
      assert.strictEqual(matched.trigger_config.webhook_token, 'whsec_****');
    });
  });

  // 5. M-2 / P8: Quota Check Race Condition & Atomic Conditional Update
  describe('M-2 / P8: Quota Race Condition Atomic Check', () => {
    it('atomically enforces quota without exceeding limit in conditional SQL update', () => {
      const workspaceId = 'ws_atomic_quota_test';
      testDb.db.prepare(`
        INSERT INTO workspaces (id, name, slug, owner_id)
        VALUES (?, 'Atomic Quota WS', 'atomic-quota-ws', 'usr_owner')
      `).run(workspaceId);

      // Set usage to 49 runs under free plan (50 limit)
      testDb.db.prepare(`
        INSERT INTO usage_meters (id, workspace_id, billing_period, runs_count, ai_steps_count, updated_at)
        VALUES ('meter_test_race', ?, '2026-10', 49, 0, datetime('now'))
      `).run(workspaceId);

      // Run 50 succeeds
      const r1 = checkAndIncrementQuota(workspaceId, testDb.db);
      assert.strictEqual(r1.allowed, true);
      assert.strictEqual(r1.runs_used, 50);

      // Run 51 is blocked with 429 QUOTA_EXCEEDED
      assert.throws(
        () => checkAndIncrementQuota(workspaceId, testDb.db),
        (err) => {
          return err.statusCode === 429 && err.code === 'QUOTA_EXCEEDED';
        }
      );
    });
  });

  // 6. M-3 / P7: Webhook Payload Size Limits & Stored Payloads
  describe('M-3 / P7: Webhook Payload Size Boundaries & Truncation', () => {
    it('rejects public webhook payload exceeding 1MB with HTTP 413 PAYLOAD_TOO_LARGE', async () => {
      const owner = await registerUser('payload_owner@corp.com', 'Payload Owner', 'Payload WS');
      const token = 'token_for_oversize_test';

      await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${owner.token}`)
        .set('x-workspace-id', owner.workspace.id)
        .send({
          name: 'Oversize Webhook Workflow',
          trigger_type: 'webhook',
          trigger_config: { webhook_token: token },
          steps: [{ id: 's1', name: 'Step 1', type: 'doc_extraction', order: 1 }]
        });

      // Generate a payload > 1MB (1.1MB)
      const oversizedPayload = {
        data: 'x'.repeat(1024 * 1024 + 1024)
      };

      const res = await request(app)
        .post(`/api/workflows/triggers/webhook/${token}`)
        .send(oversizedPayload);

      assert.strictEqual(res.status, 413);
      assert.strictEqual(res.body.error, 'PAYLOAD_TOO_LARGE');
    });
  });

  // 7. Hygiene: Error Stack Trace Suppression in Production
  describe('Hygiene & Error Boundary: Stack Trace Suppression', () => {
    it('suppresses internal stack trace when NODE_ENV is production', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        const owner = await registerUser('stack_user@corp.com', 'Stack User', 'Stack WS');
        const wfRes = await request(app)
          .post('/api/workflows')
          .set('Authorization', `Bearer ${owner.token}`)
          .set('x-workspace-id', owner.workspace.id)
          .send({
            name: 'Stack Test Workflow',
            steps: [{ id: 's1', name: 'Step 1', type: 'doc_extraction', order: 1 }]
          });
        assert.strictEqual(wfRes.status, 201);
        const workflowId = wfRes.body.workflow.id;

        const executionId = 'exec_stack_test';
        testDb.db.prepare(`
          INSERT INTO workflow_executions (id, workspace_id, workflow_id, trigger_type, status, started_at)
          VALUES (?, ?, ?, 'manual', 'running', datetime('now'))
        `).run(executionId, owner.workspace.id, workflowId);

        const error = new Error('Sensitive database timeout');
        error.code = 'DB_ERROR';

        const logId = TraceLogger.startStepLog(
          {
            executionId,
            workspaceId: owner.workspace.id,
            stepId: 'step_1',
            stepName: 'Step 1',
            stepType: 'doc_extraction',
            stepOrder: 1
          },
          testDb.db
        );

        TraceLogger.recordStepFailure(logId, error, 50, testDb.db);

        const logs = TraceLogger.getExecutionLogs(executionId, owner.workspace.id, testDb.db);
        assert.strictEqual(logs.length, 1);
        assert.strictEqual(logs[0].error_details.stack, undefined);
        assert.strictEqual(logs[0].error_details.message, 'Sensitive database timeout');
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });
  });
});
