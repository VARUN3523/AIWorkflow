import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../src/app.js';
import { setupTestDb } from '../helpers/test_db.js';
import { sampleValidInvoiceText, emptyInvoiceText } from '../fixtures/invoices.js';
import { enterpriseLeadPayload } from '../fixtures/leads.js';

describe('Workflow Execution Engine Integration Tests (R1: Features F-WF-05 to F-WF-10)', () => {
  let testDb;

  beforeEach(() => {
    testDb = setupTestDb();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  async function registerTenant(email, fullName = 'Tenant User', wsName = 'Tenant Workspace') {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email,
        password: 'Password123!Secure',
        fullName,
        workspaceName: wsName
      });

    return {
      user: res.body.user,
      workspace: res.body.workspace,
      token: res.body.token,
      authHeader: `Bearer ${res.body.token}`
    };
  }

  const standardInvoiceWorkflow = {
    name: 'End-to-End Enterprise Invoice Pipeline',
    description: 'Extracts invoices, categorizes expenses, and synthesizes briefs',
    trigger_type: 'manual',
    trigger_config: {},
    steps: [
      {
        id: 's1_extract',
        name: 'Extract Invoice Entities',
        type: 'doc_extraction',
        order: 1,
        config: {
          fields: ['invoice_number', 'vendor_name', 'total_amount', 'due_date'],
          source: '{{trigger.document_text}}'
        }
      },
      {
        id: 's2_classify',
        name: 'Classify Expense Level',
        type: 'classification',
        order: 2,
        config: {
          input: '{{steps.s1_extract.output.fields.total_amount}}',
          categories: ['Low Expense (<$500)', 'Standard Expense ($500-$5k)', 'High-Value Enterprise Expense (>$5k)'],
          fallback_category: 'Standard Expense ($500-$5k)'
        }
      },
      {
        id: 's3_synthesize',
        name: 'Synthesize CFO Brief',
        type: 'synthesis',
        order: 3,
        config: {
          template: 'Invoice for {{steps.s1_extract.output.fields.vendor_name}} with category {{steps.s2_classify.output.category}}',
          format: 'json'
        }
      }
    ]
  };

  // =========================================================================
  // 1. Multi-Step Execution Pipeline & Trace Persistence
  // =========================================================================
  describe('1. Multi-Step Pipeline Execution & Trace Persistence', () => {
    it('executes a 3-step pipeline end-to-end and persists execution record in DB', async () => {
      const tenant = await registerTenant('eng_user1@firm.com');

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send(standardInvoiceWorkflow);

      assert.strictEqual(wfRes.status, 201);
      const workflowId = wfRes.body.workflow.id;

      // Trigger manual execution
      const runRes = await request(app)
        .post(`/api/workflows/${workflowId}/run`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({ document_text: sampleValidInvoiceText });

      assert.strictEqual(runRes.status, 200);
      assert.ok(runRes.body.execution);
      assert.strictEqual(runRes.body.execution.status, 'completed');
      assert.ok(runRes.body.execution.duration_ms >= 0);

      // Verify workflow_executions row in database
      const dbExec = testDb.db
        .prepare('SELECT * FROM workflow_executions WHERE id = ?')
        .get(runRes.body.execution.id);
      assert.ok(dbExec);
      assert.strictEqual(dbExec.status, 'completed');
      assert.strictEqual(dbExec.workspace_id, tenant.workspace.id);
      assert.strictEqual(dbExec.workflow_id, workflowId);
    });

    it('persists granular step-by-step traces with inputs, outputs, and durations', async () => {
      const tenant = await registerTenant('eng_user2@firm.com');

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send(standardInvoiceWorkflow);

      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({ document_text: sampleValidInvoiceText });

      // Fetch trace
      const traceRes = await request(app)
        .get(`/api/executions/${runRes.body.execution.id}/trace`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id);

      assert.strictEqual(traceRes.status, 200);
      assert.ok(Array.isArray(traceRes.body.steps));
      assert.strictEqual(traceRes.body.steps.length, 3);

      const [step1, step2, step3] = traceRes.body.steps;

      // Step 1: Extraction
      assert.strictEqual(step1.step_type, 'doc_extraction');
      assert.strictEqual(step1.status, 'success');
      assert.strictEqual(step1.output_data.fields.invoice_number, 'INV-2026-9921');
      assert.strictEqual(step1.output_data.fields.vendor_name, 'ACME Global Technologies Ltd.');
      assert.strictEqual(step1.output_data.fields.total_amount, 14250.0);
      assert.ok(step1.duration_ms >= 0);

      // Step 2: Classification (total_amount = 14250.00 > 5000 -> High-Value Enterprise Expense)
      assert.strictEqual(step2.step_type, 'classification');
      assert.strictEqual(step2.status, 'success');
      assert.strictEqual(step2.output_data.category, 'High-Value Enterprise Expense (>$5k)');
      assert.ok(step2.output_data.confidence > 0.9);
      assert.ok(step2.output_data.reasoning.includes('14250.00'));

      // Step 3: Synthesis
      assert.strictEqual(step3.step_type, 'synthesis');
      assert.strictEqual(step3.status, 'success');
      assert.ok(step3.output_data.summary.includes('ACME Global Technologies Ltd.'));
      assert.ok(step3.output_data.summary.includes('High-Value Enterprise Expense'));
      assert.ok(Array.isArray(step3.output_data.action_items));
    });
  });

  // =========================================================================
  // 2. Variable Resolver & Context Interpolation
  // =========================================================================
  describe('2. Variable Resolver and Context Interpolation', () => {
    it('accurately resolves deep nested paths and preserves primitive and object types', async () => {
      const tenant = await registerTenant('var_test@firm.com');

      const variableWorkflow = {
        name: 'Variable Test Workflow',
        trigger_type: 'manual',
        trigger_config: {},
        steps: [
          {
            id: 'step_one',
            name: 'Extract Lead',
            type: 'doc_extraction',
            order: 1,
            config: {
              fields: ['company', 'employee_count', 'budget'],
              source: '{{trigger.payload}}'
            }
          },
          {
            id: 'step_two',
            name: 'Classify Priority',
            type: 'classification',
            order: 2,
            config: {
              input: '{{steps.step_one.output.fields.employee_count}}',
              categories: ['Enterprise Tier-1 (Urgent)', 'Mid-Market Growth', 'SMB / Self-Serve']
            }
          }
        ]
      };

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send(variableWorkflow);

      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({ payload: enterpriseLeadPayload });

      assert.strictEqual(runRes.status, 200);

      const traceRes = await request(app)
        .get(`/api/executions/${runRes.body.execution.id}/trace`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id);

      const step2 = traceRes.body.steps[1];
      assert.strictEqual(step2.status, 'success');
      assert.strictEqual(step2.output_data.category, 'Enterprise Tier-1 (Urgent)');
    });

    it('handles non-existent or null variable references safely without TypeError', async () => {
      const tenant = await registerTenant('var_null@firm.com');

      const nullVarWorkflow = {
        name: 'Null Variable Workflow',
        trigger_type: 'manual',
        trigger_config: {},
        steps: [
          {
            id: 'step_null',
            name: 'Synthesize Missing Var',
            type: 'synthesis',
            order: 1,
            config: {
              template: 'Greeting: {{steps.non_existent.output.name}} End'
            }
          }
        ]
      };

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send(nullVarWorkflow);

      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({});

      assert.strictEqual(runRes.status, 200);
      assert.strictEqual(runRes.body.execution.status, 'completed');
    });
  });

  // =========================================================================
  // 3. Graceful Failure & Defensive Error Boundaries
  // =========================================================================
  describe('3. Graceful Failure and Defensive Error Boundaries', () => {
    it('mid-pipeline step failure: preserves prior step logs and marks subsequent skipped', async () => {
      const tenant = await registerTenant('fail_user@firm.com');

      const failingWorkflow = {
        name: 'Failing Step Pipeline',
        trigger_type: 'manual',
        trigger_config: {},
        steps: [
          {
            id: 's1',
            name: 'Step 1 Succeeds',
            type: 'doc_extraction',
            order: 1,
            config: {}
          },
          {
            id: 's2',
            name: 'Step 2 Fails Intentionally',
            type: 'doc_extraction',
            order: 2,
            config: { fail_intent: true }
          },
          {
            id: 's3',
            name: 'Step 3 Skipped',
            type: 'synthesis',
            order: 3,
            config: {}
          }
        ]
      };

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send(failingWorkflow);

      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({ document_text: 'sample text' });

      // Service did not crash; returns 200 with failed status
      assert.strictEqual(runRes.status, 200);
      assert.strictEqual(runRes.body.execution.status, 'failed');

      // Check step trace logs
      const traceRes = await request(app)
        .get(`/api/executions/${runRes.body.execution.id}/trace`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id);

      assert.strictEqual(traceRes.status, 200);
      const steps = traceRes.body.steps;
      assert.strictEqual(steps.length, 3);
      assert.strictEqual(steps[0].status, 'success');
      assert.strictEqual(steps[1].status, 'failed');
      assert.strictEqual(steps[2].status, 'skipped');
    });

    it('simulated AI timeout fails gracefully with structured error message', async () => {
      const tenant = await registerTenant('timeout_user@firm.com');

      const timeoutWorkflow = {
        name: 'Timeout Workflow',
        trigger_type: 'manual',
        trigger_config: {},
        steps: [
          {
            id: 's1',
            name: 'Timeout Classification Step',
            type: 'classification',
            order: 1,
            config: { simulate_timeout: true, categories: ['A', 'B'] }
          }
        ]
      };

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send(timeoutWorkflow);

      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({ document_text: 'sample' });

      assert.strictEqual(runRes.status, 200);
      assert.strictEqual(runRes.body.execution.status, 'failed');

      const traceRes = await request(app)
        .get(`/api/executions/${runRes.body.execution.id}/trace`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id);

      assert.strictEqual(traceRes.body.steps[0].status, 'failed');
      assert.ok(traceRes.body.steps[0].error_details?.message?.includes('timeout'));
    });

    it('completely blank document input produces graceful warning state without failing', async () => {
      const tenant = await registerTenant('blank_doc@firm.com');

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'Blank Document Workflow',
          trigger_type: 'manual',
          trigger_config: {},
          steps: [
            { id: 's1', name: 'Extract Blank Doc', type: 'doc_extraction', order: 1, config: {} }
          ]
        });

      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({ document_text: emptyInvoiceText });

      assert.strictEqual(runRes.status, 200);
      assert.strictEqual(runRes.body.execution.status, 'completed');

      const traceRes = await request(app)
        .get(`/api/executions/${runRes.body.execution.id}/trace`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id);

      assert.strictEqual(traceRes.body.steps[0].status, 'success');
      assert.strictEqual(traceRes.body.steps[0].output_data?.warning, 'EMPTY_DOCUMENT');
    });
  });

  // =========================================================================
  // 4. Trigger Dispatchers
  // =========================================================================
  describe('4. Trigger Dispatchers', () => {
    it('dispatches public webhook trigger by token and records trace', async () => {
      const tenant = await registerTenant('wh_dispatch@firm.com');
      const webhookToken = 'whk_secret_token_eng_test_99';

      await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'Webhook Ingestion Pipeline',
          trigger_type: 'webhook',
          trigger_config: { webhook_token: webhookToken },
          steps: [
            { id: 's1', name: 'Extract Lead', type: 'doc_extraction', order: 1, config: {} },
            { id: 's2', name: 'Classify Lead', type: 'classification', order: 2, config: {} }
          ]
        });

      // Public POST without auth header
      const webhookRes = await request(app)
        .post(`/api/workflows/triggers/webhook/${webhookToken}`)
        .send(enterpriseLeadPayload);

      assert.strictEqual(webhookRes.status, 200);
      assert.ok(webhookRes.body.execution_id);
      assert.strictEqual(webhookRes.body.status, 'completed');

      // Authenticated tenant can inspect trace
      const traceRes = await request(app)
        .get(`/api/executions/${webhookRes.body.execution_id}/trace`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id);

      assert.strictEqual(traceRes.status, 200);
      assert.strictEqual(traceRes.body.steps.length, 2);
    });

    it('rejects public webhook with invalid token with 404 Not Found', async () => {
      const res = await request(app)
        .post('/api/workflows/triggers/webhook/totally_invalid_nonexistent_token_00')
        .send({ data: 'anything' });

      assert.strictEqual(res.status, 404);
      assert.ok(res.body.error);
    });

    it('rejects webhook with malformed JSON body with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/workflows/triggers/webhook/test_token')
        .set('Content-Type', 'application/json')
        .send('{"bad_json: ');

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'MALFORMED_JSON_PAYLOAD');
    });

    it('dispatches multipart file upload trigger and executes pipeline', async () => {
      const tenant = await registerTenant('upload_user@firm.com');

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send(standardInvoiceWorkflow);

      const uploadRes = await request(app)
        .post(`/api/workflows/triggers/upload/${wfRes.body.workflow.id}`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .attach('file', Buffer.from(sampleValidInvoiceText, 'utf-8'), 'invoice_oct_2026.txt');

      assert.strictEqual(uploadRes.status, 200);
      assert.ok(uploadRes.body.execution_id);
      assert.ok(uploadRes.body.fileId);
      assert.strictEqual(uploadRes.body.status, 'completed');
    });
  });

  // =========================================================================
  // 5. Quota Gatekeeper & Cross-Tenant Execution Isolation
  // =========================================================================
  describe('5. Quota Gatekeeping & Cross-Tenant Execution Isolation', () => {
    it('increments usage meter counter upon each workflow execution', async () => {
      const tenant = await registerTenant('meter_user@firm.com');

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send(standardInvoiceWorkflow);

      // Verify meter initially 0
      const meterBefore = testDb.db
        .prepare('SELECT runs_count FROM usage_meters WHERE workspace_id = ?')
        .get(tenant.workspace.id);
      assert.strictEqual(meterBefore.runs_count, 0);

      // Trigger run
      await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({ document_text: sampleValidInvoiceText });

      // Verify meter incremented to 1
      const meterAfter = testDb.db
        .prepare('SELECT runs_count FROM usage_meters WHERE workspace_id = ?')
        .get(tenant.workspace.id);
      assert.strictEqual(meterAfter.runs_count, 1);
    });

    it('strictly blocks execution with 429 Quota Exceeded when monthly limit is reached', async () => {
      const tenant = await registerTenant('quota_max@firm.com');

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send(standardInvoiceWorkflow);

      // Set usage counter to 50/50 (Free limit)
      testDb.db
        .prepare('UPDATE usage_meters SET runs_count = 50 WHERE workspace_id = ?')
        .run(tenant.workspace.id);

      // Attempt run 51
      const blockedRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({ document_text: sampleValidInvoiceText });

      assert.strictEqual(blockedRes.status, 429);
      assert.strictEqual(blockedRes.body.error, 'QUOTA_EXCEEDED');
      assert.match(blockedRes.body.message, /plan limit/i);
    });

    it('strictly prevents Tenant B from reading Tenant A execution traces (404 Not Found)', async () => {
      const tenantA = await registerTenant('tenantA_exec@firm.com');
      const tenantB = await registerTenant('tenantB_exec@firm.com');

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenantA.authHeader)
        .set('x-workspace-id', tenantA.workspace.id)
        .send(standardInvoiceWorkflow);

      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', tenantA.authHeader)
        .set('x-workspace-id', tenantA.workspace.id)
        .send({ document_text: sampleValidInvoiceText });

      const execId = runRes.body.execution.id;

      // Tenant B attempts to read Tenant A's execution
      const getRes = await request(app)
        .get(`/api/executions/${execId}`)
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantB.workspace.id);
      assert.strictEqual(getRes.status, 404);

      // Tenant B attempts to read Tenant A's trace
      const traceRes = await request(app)
        .get(`/api/executions/${execId}/trace`)
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantB.workspace.id);
      assert.strictEqual(traceRes.status, 404);
    });
  });
});
