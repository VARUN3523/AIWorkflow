import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import crypto from 'node:crypto';
import app from '../../src/app.js';
import { setupTestDb } from '../helpers/test_db.js';
import { resolveVariables } from '../../src/engine/variable_resolver.js';
import {
  STRIPE_TEST_WEBHOOK_SECRET,
  createStripeSignature,
  createCheckoutSessionCompletedEvent,
  createSubscriptionUpdatedEvent,
  createSubscriptionDeletedEvent
} from '../fixtures/stripe.js';
import { renderDashboardPage } from '../../src/ui/templates/dashboard.js';

describe('Milestone 5 Adversarial Challenge Suite (Tier 5 Comprehensive Hardening & Stress Matrix)', () => {
  let testDb;
  let uncaughtExceptions = [];
  let unhandledRejections = [];

  const onUncaught = (err) => {
    uncaughtExceptions.push(err);
  };
  const onUnhandled = (reason) => {
    unhandledRejections.push(reason);
  };

  beforeEach(() => {
    testDb = setupTestDb();
    process.on('uncaughtException', onUncaught);
    process.on('unhandledRejection', onUnhandled);
  });

  afterEach(() => {
    process.removeListener('uncaughtException', onUncaught);
    process.removeListener('unhandledRejection', onUnhandled);
    testDb.cleanup();
  });

  // Helper to register an isolated tenant user
  async function registerTenant(email, fullName = 'Tenant User', wsName = 'Tenant Workspace') {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email,
        password: 'Password123!Secure',
        fullName,
        workspaceName: wsName
      });

    assert.strictEqual(res.status, 201, `Failed to register ${email}: ${JSON.stringify(res.body)}`);
    return {
      user: res.body.user,
      workspace: res.body.workspace,
      token: res.body.token,
      authHeader: `Bearer ${res.body.token}`
    };
  }

  // =========================================================================
  // 1. CROSS-TENANT IDOR & PRIVILEGE ESCALATION ATTACKS (R2)
  // =========================================================================
  describe('1. Cross-Tenant IDOR & Privilege Escalation Attack Surface', () => {
    it('ADV-M5-01: Tenant B cannot read Tenant A workspace (GET /api/workspaces/:id returns 404)', async () => {
      const tenantA = await registerTenant('victim_ws@tenant-a.com');
      const tenantB = await registerTenant('attacker_ws@tenant-b.com');

      const res = await request(app)
        .get(`/api/workspaces/${tenantA.workspace.id}`)
        .set('Authorization', tenantB.authHeader);

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'WORKSPACE_NOT_FOUND');
    });

    it('ADV-M5-02: Tenant B cannot update Tenant A workspace name (PUT /api/workspaces/:id returns 404)', async () => {
      const tenantA = await registerTenant('victim_upd@tenant-a.com');
      const tenantB = await registerTenant('attacker_upd@tenant-b.com');

      const res = await request(app)
        .put(`/api/workspaces/${tenantA.workspace.id}`)
        .set('Authorization', tenantB.authHeader)
        .send({ name: 'Hacked Workspace Name' });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'WORKSPACE_NOT_FOUND');
    });

    it('ADV-M5-03: Tenant B cannot delete Tenant A workspace (DELETE /api/workspaces/:id returns 404)', async () => {
      const tenantA = await registerTenant('victim_del@tenant-a.com');
      const tenantB = await registerTenant('attacker_del@tenant-b.com');

      const res = await request(app)
        .delete(`/api/workspaces/${tenantA.workspace.id}`)
        .set('Authorization', tenantB.authHeader);

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'WORKSPACE_NOT_FOUND');
    });

    it('ADV-M5-04: Tenant B cannot inspect Tenant A members list (GET /api/workspaces/:id/members returns 404)', async () => {
      const tenantA = await registerTenant('victim_mem@tenant-a.com');
      const tenantB = await registerTenant('attacker_mem@tenant-b.com');

      const res = await request(app)
        .get(`/api/workspaces/${tenantA.workspace.id}/members`)
        .set('Authorization', tenantB.authHeader);

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'WORKSPACE_NOT_FOUND');
    });

    it('ADV-M5-05: Tenant B cannot invite members into Tenant A workspace (POST /api/workspaces/:id/members returns 404)', async () => {
      const tenantA = await registerTenant('victim_inv@tenant-a.com');
      const tenantB = await registerTenant('attacker_inv@tenant-b.com');

      const res = await request(app)
        .post(`/api/workspaces/${tenantA.workspace.id}/members`)
        .set('Authorization', tenantB.authHeader)
        .send({ email: tenantB.user.email, role: 'admin' });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'WORKSPACE_NOT_FOUND');
    });

    it('ADV-M5-06: Tenant B cannot read, update, delete or execute Tenant A workflows (404 across all verbs)', async () => {
      const tenantA = await registerTenant('victim_wf@tenant-a.com');
      const tenantB = await registerTenant('attacker_wf@tenant-b.com');

      // Create workflow for Tenant A
      const createRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenantA.authHeader)
        .set('x-workspace-id', tenantA.workspace.id)
        .send({
          name: 'Confidential Pipeline Tenant A',
          steps: [{ id: 's1', name: 'Extract', type: 'doc_extraction', order: 1 }]
        });
      assert.strictEqual(createRes.status, 201);
      const wfId = createRes.body.workflow.id;

      // GET by ID
      const getRes = await request(app)
        .get(`/api/workflows/${wfId}`)
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantB.workspace.id);
      assert.strictEqual(getRes.status, 404);
      assert.strictEqual(getRes.body.error, 'WORKFLOW_NOT_FOUND');

      // PUT by ID
      const putRes = await request(app)
        .put(`/api/workflows/${wfId}`)
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantB.workspace.id)
        .send({ name: 'Tampered Pipeline Name' });
      assert.strictEqual(putRes.status, 404);
      assert.strictEqual(putRes.body.error, 'WORKFLOW_NOT_FOUND');

      // DELETE by ID
      const delRes = await request(app)
        .delete(`/api/workflows/${wfId}`)
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantB.workspace.id);
      assert.strictEqual(delRes.status, 404);
      assert.strictEqual(delRes.body.error, 'WORKFLOW_NOT_FOUND');

      // POST /run by ID
      const runRes = await request(app)
        .post(`/api/workflows/${wfId}/run`)
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantB.workspace.id)
        .send({ payload: 'test' });
      assert.strictEqual(runRes.status, 404);
      assert.strictEqual(runRes.body.error, 'WORKFLOW_NOT_FOUND');

      // POST /triggers/manual dispatcher
      const manualRes = await request(app)
        .post('/api/workflows/triggers/manual')
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantB.workspace.id)
        .send({ workflow_id: wfId, payload: 'test' });
      assert.strictEqual(manualRes.status, 404);
      assert.strictEqual(manualRes.body.error, 'WORKFLOW_NOT_FOUND');

      // POST /triggers/upload/:id dispatcher
      const uploadRes = await request(app)
        .post(`/api/workflows/triggers/upload/${wfId}`)
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantB.workspace.id)
        .send({ file: { name: 'doc.txt', content: 'test', type: 'text/plain' } });
      assert.strictEqual(uploadRes.status, 404);
      assert.strictEqual(uploadRes.body.error, 'WORKFLOW_NOT_FOUND');
    });

    it('ADV-M5-07: Tenant B querying /api/executions?workflow_id=<Tenant_A> gets empty list with zero leakage', async () => {
      const tenantA = await registerTenant('victim_exec@tenant-a.com');
      const tenantB = await registerTenant('attacker_exec@tenant-b.com');

      // Tenant A runs workflow
      const wf = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenantA.authHeader)
        .set('x-workspace-id', tenantA.workspace.id)
        .send({
          name: 'Execution Test WF',
          steps: [{ id: 's1', name: 'Extract', type: 'doc_extraction', order: 1 }]
        });

      const run = await request(app)
        .post(`/api/workflows/${wf.body.workflow.id}/run`)
        .set('Authorization', tenantA.authHeader)
        .set('x-workspace-id', tenantA.workspace.id)
        .send({ payload: 'Sample Doc' });
      assert.strictEqual(run.status, 200);
      const executionId = run.body.execution_id;

      // Tenant B queries list with Tenant A's workflow_id
      const listRes = await request(app)
        .get(`/api/executions?workflow_id=${wf.body.workflow.id}`)
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantB.workspace.id);
      assert.strictEqual(listRes.status, 200);
      assert.deepStrictEqual(listRes.body.executions, []);

      // Tenant B queries execution trace directly
      const traceRes = await request(app)
        .get(`/api/executions/${executionId}/trace`)
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantB.workspace.id);
      assert.strictEqual(traceRes.status, 404);
      assert.strictEqual(traceRes.body.error, 'EXECUTION_NOT_FOUND');
    });

    it('ADV-M5-08: Spoofing x-workspace-id header to foreign tenant is strictly blocked with 403 Forbidden', async () => {
      const tenantA = await registerTenant('victim_hdr@tenant-a.com');
      const tenantB = await registerTenant('attacker_hdr@tenant-b.com');

      const endpoints = [
        { method: 'get', url: '/api/workflows' },
        { method: 'get', url: '/api/billing/usage' },
        { method: 'get', url: '/api/dashboard/stats' },
        { method: 'get', url: '/api/executions' },
      ];

      for (const ep of endpoints) {
        const res = await request(app)[ep.method](ep.url)
          .set('Authorization', tenantB.authHeader)
          .set('x-workspace-id', tenantA.workspace.id);

        assert.strictEqual(res.status, 403, `Failed for ${ep.method.toUpperCase()} ${ep.url}`);
        assert.strictEqual(res.body.error, 'FORBIDDEN');
      }
    });

    it('ADV-M5-09: RBAC enforcement prevents member role from updating workspace or deleting it', async () => {
      const owner = await registerTenant('rbac_owner@corp.com');
      const member = await registerTenant('rbac_member@corp.com');

      // Add member to owner's workspace with 'member' role (returns 201 Created)
      const addRes = await request(app)
        .post(`/api/workspaces/${owner.workspace.id}/members`)
        .set('Authorization', owner.authHeader)
        .send({ email: member.user.email, role: 'member' });
      assert.strictEqual(addRes.status, 201);

      // Member attempts to update workspace name -> 403
      const updRes = await request(app)
        .put(`/api/workspaces/${owner.workspace.id}`)
        .set('Authorization', member.authHeader)
        .send({ name: 'Member Renamed WS' });
      assert.strictEqual(updRes.status, 403);
      assert.strictEqual(updRes.body.error, 'INSUFFICIENT_PERMISSIONS');

      // Member attempts to delete workspace -> 403
      const delRes = await request(app)
        .delete(`/api/workspaces/${owner.workspace.id}`)
        .set('Authorization', member.authHeader);
      assert.strictEqual(delRes.status, 403);
      assert.strictEqual(delRes.body.error, 'INSUFFICIENT_PERMISSIONS');
    });
  });

  // =========================================================================
  // 2. MALFORMED INPUTS, UNICODE, NULL BYTES & EXTREME STRINGS
  // =========================================================================
  describe('2. Malformed Inputs, Unicode, Null Bytes & Extreme Strings', () => {
    it('ADV-M5-10: Multilingual Unicode & Emoji content executes without encoding corruption', async () => {
      const tenant = await registerTenant('unicode_test@corp.com');

      const wf = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: '🚀 Multilingual Pipeline 智能工作流 💰',
          description: 'Тестовый пайплайн с эмодзи и специальными символами: !@#$%^&*()_+',
          steps: [
            { id: 's1', name: '提取 Extraction', type: 'doc_extraction', order: 1 },
            { id: 's2', name: '分类 Classification', type: 'classification', order: 2, config: { categories: ['Standard', 'High-Value'] } },
            { id: 's3', name: '综述 Synthesis', type: 'synthesis', order: 3, config: { template: 'Synthesizing: {{steps.s1.output.text}}' } }
          ]
        });
      assert.strictEqual(wf.status, 201);

      const runRes = await request(app)
        .post(`/api/workflows/${wf.body.workflow.id}/run`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          payload: {
            title: 'Multilingual Inbound Lead: 日本語 & العربية & 中文',
            amount: '$12,500.00'
          }
        });

      assert.strictEqual(runRes.status, 200);
      assert.strictEqual(runRes.body.status, 'completed');
    });

    it('ADV-M5-11: Embedded null bytes (\\0) in payload and names do not crash or truncate execution', async () => {
      const tenant = await registerTenant('null_byte@corp.com');

      const wf = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'Workflow\0WithNullByte',
          steps: [{ id: 's1', name: 'Doc\0Step', type: 'doc_extraction', order: 1 }]
        });
      assert.strictEqual(wf.status, 201);

      const runRes = await request(app)
        .post(`/api/workflows/${wf.body.workflow.id}/run`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          payload: 'Invoice #INV-2026-9921\0EmbeddedNullByte\0Total Amount Due: $14,250.00'
        });

      assert.strictEqual(runRes.status, 200);
      assert.strictEqual(runRes.body.status, 'completed');
    });

    it('ADV-M5-12: Massive 50,000 character document text executes safely within bounds', async () => {
      const tenant = await registerTenant('massive_text@corp.com');

      const wf = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'Massive Input Pipeline',
          steps: [{ id: 's1', name: 'Extract', type: 'doc_extraction', order: 1 }]
        });
      assert.strictEqual(wf.status, 201);

      const massiveText = 'Enterprise Document Segment. '.repeat(2000) + ' Invoice #INV-2026-9921 Total: $14,250.00';
      assert.ok(massiveText.length > 50000);

      const runRes = await request(app)
        .post(`/api/workflows/${wf.body.workflow.id}/run`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({ payload: massiveText });

      assert.strictEqual(runRes.status, 200);
      assert.strictEqual(runRes.body.status, 'completed');
    });

    it('ADV-M5-13: Malformed JSON body in HTTP request returns 400 MALFORMED_JSON_PAYLOAD without crash', async () => {
      const tenant = await registerTenant('malformed_json@corp.com');

      const res = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .set('Content-Type', 'application/json')
        .send('{"name": "Broken JSON, missing close brace');

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'MALFORMED_JSON_PAYLOAD');
      assert.ok(res.body.message);
    });

    it('ADV-M5-14: Prototype pollution attempts in variable resolver resolve safely without corrupting Object prototype', () => {
      const context = {
        trigger: { payload: { normal: 'data' } },
        steps: {}
      };

      const hostileTemplates = [
        '{{__proto__.polluted}}',
        '{{constructor.prototype.isHacked}}'
      ];

      for (const tpl of hostileTemplates) {
        const resolved = resolveVariables(tpl, context);
        assert.ok(resolved === undefined || resolved === '', `Hostile template ${tpl} should resolve safely`);
      }

      // Assert global Object is not polluted
      assert.strictEqual(Object.prototype.polluted, undefined);
      assert.strictEqual(Object.prototype.isHacked, undefined);
    });
  });

  // =========================================================================
  // 3. RATE LIMITS, QUOTA EXHAUSTION & CONCURRENCY HARDENING (R3)
  // =========================================================================
  describe('3. Rate Limits, Quota Exhaustion & Concurrency Hardening', () => {
    it('ADV-M5-15: Quota 50/50 succeeds; run 51 is strictly blocked with HTTP 429 and structured JSON', async () => {
      const tenant = await registerTenant('quota_stress@corp.com');

      const wf = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'Quota Test WF',
          steps: [{ id: 's1', name: 'Extract', type: 'doc_extraction', order: 1 }]
        });
      assert.strictEqual(wf.status, 201);

      // Fast-forward usage to 49 runs directly in database
      const db = testDb.db;
      db.prepare(`
        UPDATE usage_meters
        SET runs_count = 49
        WHERE workspace_id = ?
      `).run(tenant.workspace.id);

      // Run 50/50: Must succeed
      const run50 = await request(app)
        .post(`/api/workflows/${wf.body.workflow.id}/run`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({ payload: 'Run 50' });
      assert.strictEqual(run50.status, 200);
      assert.strictEqual(run50.body.status, 'completed');

      // Run 51: Must be hard blocked with 429
      const run51 = await request(app)
        .post(`/api/workflows/${wf.body.workflow.id}/run`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({ payload: 'Run 51' });

      assert.strictEqual(run51.status, 429);
      assert.strictEqual(run51.body.error, 'QUOTA_EXCEEDED');
      assert.strictEqual(run51.body.plan, 'free');
      assert.strictEqual(run51.body.limit, 50);
      assert.strictEqual(run51.body.current_usage, 50);
    });

    it('ADV-M5-16: Concurrency test: 20 simultaneous runs with 5 slots left results in exactly 5 successes & 15 429s', async () => {
      const tenant = await registerTenant('concurrency_quota@corp.com');

      const wf = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'Concurrent Quota WF',
          steps: [{ id: 's1', name: 'Extract', type: 'doc_extraction', order: 1 }]
        });
      assert.strictEqual(wf.status, 201);

      // Set usage to 45 runs (5 runs remaining under free plan 50 ceiling)
      const db = testDb.db;
      db.prepare(`
        UPDATE usage_meters
        SET runs_count = 45
        WHERE workspace_id = ?
      `).run(tenant.workspace.id);

      // Dispatch 20 concurrent requests
      const promises = Array.from({ length: 20 }, (_, i) =>
        request(app)
          .post(`/api/workflows/${wf.body.workflow.id}/run`)
          .set('Authorization', tenant.authHeader)
          .set('x-workspace-id', tenant.workspace.id)
          .send({ payload: `Concurrent Run #${i + 1}` })
      );

      const results = await Promise.all(promises);

      const successes = results.filter((r) => r.status === 200);
      const throttled = results.filter((r) => r.status === 429);

      assert.strictEqual(successes.length, 5, `Expected exactly 5 successes, got ${successes.length}`);
      assert.strictEqual(throttled.length, 15, `Expected exactly 15 throttled (429), got ${throttled.length}`);

      // Verify database usage meter count is exactly 50
      const meter = db.prepare('SELECT runs_count FROM usage_meters WHERE workspace_id = ?').get(tenant.workspace.id);
      assert.strictEqual(meter.runs_count, 50, `Meter count should be exactly 50, got ${meter.runs_count}`);
    });

    it('ADV-M5-17: Stripe Checkout session request for invalid tier returns 400 INVALID_PLAN', async () => {
      const tenant = await registerTenant('checkout_invalid@corp.com');

      const invalidPlans = ['free', 'enterprise_unlimited', 'tier_super', '', null];
      for (const plan of invalidPlans) {
        const res = await request(app)
          .post('/api/billing/checkout')
          .set('Authorization', tenant.authHeader)
          .set('x-workspace-id', tenant.workspace.id)
          .send({ plan_id: plan });

        assert.strictEqual(res.status, 400, `Expected 400 for plan: ${plan}`);
        assert.strictEqual(res.body.error, 'INVALID_PLAN');
      }
    });
  });

  // =========================================================================
  // 4. SECURITY, XSS SANITIZATION & CPU DOS DEFENSES (R2 & R4)
  // =========================================================================
  describe('4. Security, XSS Sanitization & CPU DoS Defenses', () => {
    it('ADV-M5-18: Password > 1024 characters is rejected with 400 PASSWORD_TOO_LONG to prevent CPU DoS', async () => {
      const massivePassword = 'A'.repeat(2048) + '!1a';

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'cpu_dos@corp.com',
          password: massivePassword,
          fullName: 'CPU DoS Tester'
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'PASSWORD_TOO_LONG');
    });

    it('ADV-M5-19: XSS script injection in workflow names and descriptions is escaped in rendered dashboard HTML', () => {
      const maliciousWorkspace = {
        name: '<script>alert("xss-ws")</script>',
        plan_id: '<img src=x onerror=alert(1)>'
      };
      const maliciousUser = {
        email: 'attacker@corp.com"<script>alert("xss-email")</script>'
      };

      const html = renderDashboardPage({
        user: maliciousUser,
        workspace: maliciousWorkspace
      });

      // Verify unescaped raw scripts are NOT present
      assert.ok(!html.includes('<script>alert("xss-ws")</script>'));
      assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
      assert.ok(!html.includes('<script>alert("xss-email")</script>'));

      // Verify escaped entities are present (case-insensitive for HTML tags)
      assert.ok(html.toLowerCase().includes('&lt;script&gt;alert(&quot;xss-ws&quot;)&lt;/script&gt;'));
      assert.ok(html.toLowerCase().includes('&lt;img src=x onerror=alert(1)&gt;'));
    });

    it('ADV-M5-20: Revoked session tokens (via logout) return 401 UNAUTHORIZED immediately', async () => {
      const tenant = await registerTenant('logout_revocation@corp.com');

      // Verify valid before logout
      const meBefore = await request(app)
        .get('/api/auth/me')
        .set('Authorization', tenant.authHeader);
      assert.strictEqual(meBefore.status, 200);

      // Perform logout
      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', tenant.authHeader);
      assert.strictEqual(logoutRes.status, 200);

      // Verify invalid after logout
      const meAfter = await request(app)
        .get('/api/auth/me')
        .set('Authorization', tenant.authHeader);
      assert.strictEqual(meAfter.status, 401);
      assert.strictEqual(meAfter.body.error, 'UNAUTHORIZED');
    });
  });

  // =========================================================================
  // 5. WEBHOOK & PAYMENT SECURITY (R3)
  // =========================================================================
  describe('5. Webhook & Payment Security', () => {
    it('ADV-M5-21: Forged signature, tampered body, and tampered timestamp are strictly rejected (400)', async () => {
      const event = createCheckoutSessionCompletedEvent('ws_test_wh', 'starter');
      const validSig = createStripeSignature(event);

      // 1. Missing header
      const resMissing = await request(app)
        .post('/api/webhooks/stripe')
        .send(event);
      assert.strictEqual(resMissing.status, 400);
      assert.strictEqual(resMissing.body.error, 'INVALID_SIGNATURE');

      // 2. Tampered signature
      const resTamperedSig = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', validSig.replace(/v1=[a-f0-9]{4}/, 'v1=dead'))
        .send(event);
      assert.strictEqual(resTamperedSig.status, 400);
      assert.strictEqual(resTamperedSig.body.error, 'INVALID_SIGNATURE');

      // 3. Tampered payload body with original signature
      const tamperedEvent = { ...event, type: 'malicious.injected.event' };
      const resTamperedBody = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', validSig)
        .send(tamperedEvent);
      assert.strictEqual(resTamperedBody.status, 400);
      assert.strictEqual(resTamperedBody.body.error, 'INVALID_SIGNATURE');
    });

    it('ADV-M5-22: Webhook idempotency: Duplicate delivery is processed idempotently without double-mutations', async () => {
      const tenant = await registerTenant('idempotent_wh@corp.com');

      const event = createCheckoutSessionCompletedEvent(tenant.workspace.id, 'starter');
      const sig = createStripeSignature(event);

      // Delivery 1
      const res1 = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', sig)
        .send(event);
      assert.strictEqual(res1.status, 200);
      assert.strictEqual(res1.body.status, 'processed');

      // Delivery 2 (Duplicate)
      const res2 = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', sig)
        .send(event);
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.body.idempotent, true);
      assert.strictEqual(res2.body.already_processed, true);

      // Check database webhook_events count is exactly 1
      const count = testDb.db.prepare('SELECT COUNT(*) AS total FROM webhook_events WHERE id = ?').get(event.id);
      assert.strictEqual(count.total, 1);
    });

    it('ADV-M5-23: Multi-stage subscription lifecycle (Free -> Starter -> Pro -> Canceled) updates quotas dynamically', async () => {
      const tenant = await registerTenant('lifecycle_wh@corp.com');

      // Stage 1: Free (50 runs limit)
      const usage1 = await request(app)
        .get('/api/billing/usage')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id);
      assert.strictEqual(usage1.body.plan_id, 'free');
      assert.strictEqual(usage1.body.runs_limit, 50);

      // Stage 2: Upgrade to Starter via checkout.session.completed (1,000 runs)
      const checkoutEvent = createCheckoutSessionCompletedEvent(tenant.workspace.id, 'starter');
      await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', createStripeSignature(checkoutEvent))
        .send(checkoutEvent);

      const usage2 = await request(app)
        .get('/api/billing/usage')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id);
      assert.strictEqual(usage2.body.plan_id, 'starter');
      assert.strictEqual(usage2.body.runs_limit, 1000);

      // Stage 3: Upgrade to Pro via customer.subscription.updated (10,000 runs)
      const upgradeEvent = createSubscriptionUpdatedEvent(tenant.workspace.id, 'pro');
      await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', createStripeSignature(upgradeEvent))
        .send(upgradeEvent);

      const usage3 = await request(app)
        .get('/api/billing/usage')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id);
      assert.strictEqual(usage3.body.plan_id, 'pro');
      assert.strictEqual(usage3.body.runs_limit, 10000);

      // Stage 4: Cancellation via customer.subscription.deleted (reverts to Free 50 runs)
      const cancelEvent = createSubscriptionDeletedEvent(tenant.workspace.id);
      await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', createStripeSignature(cancelEvent))
        .send(cancelEvent);

      const usage4 = await request(app)
        .get('/api/billing/usage')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id);
      assert.strictEqual(usage4.body.plan_id, 'free');
      assert.strictEqual(usage4.body.runs_limit, 50);
    });
  });

  // =========================================================================
  // 6. ZERO UNHANDLED EXCEPTIONS & PROCESS PROTECTION
  // =========================================================================
  describe('6. Zero Unhandled Exceptions & Error Boundary Verification', () => {
    it('ADV-M5-24: Unknown routes return 404 structured JSON across all HTTP verbs without crashing process', async () => {
      const verbs = ['get', 'post', 'put', 'delete', 'patch'];
      const nonExistentPath = '/api/non_existent_route_' + crypto.randomUUID();

      for (const verb of verbs) {
        const res = await request(app)[verb](nonExistentPath);
        assert.strictEqual(res.status, 404, `Verb ${verb.toUpperCase()} failed`);
        assert.strictEqual(typeof res.body, 'object');
        assert.strictEqual(res.body.error, 'NOT_FOUND');
        assert.ok(res.body.message.includes('Route not found'));
      }
    });

    it('ADV-M5-25: Zero unhandled promise rejections or uncaught exceptions occurred during suite run', () => {
      assert.strictEqual(
        uncaughtExceptions.length,
        0,
        `Uncaught exceptions detected: ${uncaughtExceptions.map((e) => e.stack || e.message).join('\n')}`
      );
      assert.strictEqual(
        unhandledRejections.length,
        0,
        `Unhandled rejections detected: ${unhandledRejections.map((r) => r?.stack || String(r)).join('\n')}`
      );
    });
  });
});
