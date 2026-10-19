import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../src/app.js';
import { setupTestDb } from '../helpers/test_db.js';
import { executeWorkflow } from '../../src/engine/runner.js';
import { resolveVariables } from '../../src/engine/variable_resolver.js';
import { TraceLogger } from '../../src/engine/logger.js';

describe('Milestone 2 Adversarial Challenge Suite (R1: Robustness, IDOR, Malformed Inputs & Engine Resilience)', () => {
  let testDb;

  beforeEach(() => {
    testDb = setupTestDb();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  // Helper to register an isolated test tenant
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

  /* ========================================================================
   * 1. INVALID STEP CONFIGS & VARIABLE RESOLUTION ATTACKS
   * ======================================================================== */
  describe('1. Invalid Step Configurations & Variable Resolution Attacks', () => {
    it('ATTACK-1.1: Rejects creation of workflow with unsupported step type (400 INVALID_STEP_TYPE)', async () => {
      const tenant = await registerTenant('adv1_1@corp.com');

      const res = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'Exploit Unsupported Processor',
          steps: [
            { id: 's1', name: 'Step 1', type: 'doc_extraction', order: 1 },
            { id: 's2', name: 'Exploit Step', type: 'arbitrary_shell_exec', order: 2 }
          ]
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'INVALID_STEP_TYPE');
      assert.match(res.body.message, /unsupported step processor type/i);
    });

    it('ATTACK-1.2: Rejects malformed step items (null, number, non-object) with 400 INVALID_STEP_SCHEMA', async () => {
      const tenant = await registerTenant('adv1_2@corp.com');

      const res = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'Malformed Step Array',
          steps: [
            { id: 's1', name: 'Valid Step', type: 'doc_extraction', order: 1 },
            null,
            'corrupted_step_entry'
          ]
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'INVALID_STEP_SCHEMA');
    });

    it('ATTACK-1.3: Rejects update with zero steps or empty step array (400 INVALID_STEPS)', async () => {
      const tenant = await registerTenant('adv1_3@corp.com');

      const created = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'Initially Valid Workflow',
          steps: [{ id: 's1', name: 'Extract', type: 'doc_extraction', order: 1 }]
        });

      const res = await request(app)
        .put(`/api/workflows/${created.body.workflow.id}`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({ steps: [] });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'INVALID_STEPS');
    });

    it('ATTACK-1.4: Handles circular/backward variable references gracefully without infinite loops or crashes', async () => {
      const tenant = await registerTenant('adv1_4@corp.com');

      // Step 1 references Step 2 output (which does not exist yet at Step 1 run time)
      // Step 2 references Step 1 output
      const circularWorkflow = {
        name: 'Circular Variable Reference Pipeline',
        trigger_type: 'manual',
        steps: [
          {
            id: 's1',
            name: 'Forward Reference Step',
            type: 'classification',
            order: 1,
            config: {
              input: '{{steps.s2.output.synthesized_output}}',
              categories: ['ClassA', 'ClassB']
            }
          },
          {
            id: 's2',
            name: 'Backward Reference Step',
            type: 'synthesis',
            order: 2,
            config: {
              template: 'Synthesis of {{steps.s1.output.category}}'
            }
          }
        ]
      };

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send(circularWorkflow);

      assert.strictEqual(wfRes.status, 201);

      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({ document_text: 'Test document content' });

      // Engine must not hang or crash; completes gracefully with fallback classification
      assert.strictEqual(runRes.status, 200);
      assert.strictEqual(runRes.body.execution.status, 'completed');

      const traceRes = await request(app)
        .get(`/api/executions/${runRes.body.execution.id}/trace`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id);

      assert.strictEqual(traceRes.body.steps.length, 2);
      assert.strictEqual(traceRes.body.steps[0].status, 'success');
      assert.strictEqual(traceRes.body.steps[1].status, 'success');
    });

    it('ATTACK-1.5: Safely handles non-existent deeply nested variable paths ({{steps.ghost.output.deep.none}})', async () => {
      const tenant = await registerTenant('adv1_5@corp.com');

      const missingVarWorkflow = {
        name: 'Deep Missing Variable Pipeline',
        trigger_type: 'manual',
        steps: [
          {
            id: 's1',
            name: 'Extract',
            type: 'doc_extraction',
            order: 1,
            config: {
              source: '{{steps.non_existent_step.output.unknown.deeply.nested.property}}'
            }
          },
          {
            id: 's2',
            name: 'Synthesize Missing',
            type: 'synthesis',
            order: 2,
            config: {
              template: 'Value is: [{{steps.ghost.output.missing_field}}] end.'
            }
          }
        ]
      };

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send(missingVarWorkflow);

      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({});

      assert.strictEqual(runRes.status, 200);
      assert.strictEqual(runRes.body.execution.status, 'completed');

      const traceRes = await request(app)
        .get(`/api/executions/${runRes.body.execution.id}/trace`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id);

      // Template safely replaced missing variable with empty string
      const step2 = traceRes.body.steps[1];
      assert.strictEqual(step2.output_data.summary, 'Value is: [] end.');
    });

    it('ATTACK-1.6: Prototype property access in variable resolution does not pollute or leak object internals', async () => {
      const context = {
        trigger: { payload: 'hello' },
        steps: {}
      };

      // Variable resolver resolving prototype properties
      const resolvedProto = resolveVariables('{{__proto__}}', context);
      const resolvedCtor = resolveVariables('{{constructor}}', context);

      // Verify Object prototype is not corrupted
      assert.strictEqual(Object.prototype.polluted, undefined);
      assert.strictEqual(({}).polluted, undefined);
    });

    it('ATTACK-1.7: Direct execution of injected unsupported step type marks step failed without server crash', async () => {
      const tenant = await registerTenant('adv1_7@corp.com');

      // Simulate a raw database workflow row containing an unsupported step processor
      const rawWorkflow = {
        id: 'wf_raw_injected',
        workspace_id: tenant.workspace.id,
        trigger_type: 'manual',
        steps: [
          { id: 's1', name: 'Unsupported Step', type: 'crypto_miner', order: 1 },
          { id: 's2', name: 'Subsequent Step', type: 'doc_extraction', order: 2 }
        ]
      };

      testDb.db.prepare(
        "INSERT INTO workflows (id, workspace_id, name, trigger_type, steps) VALUES (?, ?, 'Raw Injected', ?, ?)"
      ).run(rawWorkflow.id, tenant.workspace.id, rawWorkflow.trigger_type, JSON.stringify(rawWorkflow.steps));

      const execution = await executeWorkflow(
        {
          workflow: rawWorkflow,
          workspaceId: tenant.workspace.id,
          triggerType: 'manual',
          triggerPayload: {}
        },
        testDb.db
      );

      assert.strictEqual(execution.status, 'failed');
      assert.match(execution.error_message, /unsupported step type "crypto_miner"/i);

      // Verify trace records Step 1 as failed and Step 2 as skipped
      const logs = testDb.db
        .prepare('SELECT step_id, status FROM step_execution_logs WHERE execution_id = ? ORDER BY step_order ASC')
        .all(execution.id);

      assert.strictEqual(logs.length, 2);
      assert.strictEqual(logs[0].step_id, 's1');
      assert.strictEqual(logs[0].status, 'failed');
      assert.strictEqual(logs[1].step_id, 's2');
      assert.strictEqual(logs[1].status, 'skipped');
    });
  });

  /* ========================================================================
   * 2. MALFORMED TRIGGERS & ATTACK PAYLOADS
   * ======================================================================== */
  describe('2. Malformed Triggers & Attack Payloads', () => {
    it('ATTACK-2.1: Rejects webhook requests with non-existent token with 404 WEBHOOK_TOKEN_NOT_FOUND', async () => {
      const res = await request(app)
        .post('/api/workflows/triggers/webhook/completely_non_existent_token_xyz_999')
        .send({ document_text: 'sample' });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'WEBHOOK_TOKEN_NOT_FOUND');
    });

    it('ATTACK-2.2: Rejects webhook for inactive/paused workflow with 404 WEBHOOK_TOKEN_NOT_FOUND', async () => {
      const tenant = await registerTenant('adv2_2@corp.com');
      const token = 'whk_paused_token_123';

      // Create workflow with paused status
      await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'Paused Webhook Pipeline',
          trigger_type: 'webhook',
          trigger_config: { webhook_token: token },
          status: 'paused',
          steps: [{ id: 's1', name: 'Extract', type: 'doc_extraction', order: 1 }]
        });

      const res = await request(app)
        .post(`/api/workflows/triggers/webhook/${token}`)
        .send({ data: 'test' });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'WEBHOOK_TOKEN_NOT_FOUND');
    });

    it('ATTACK-2.3: Rejects SQL injection in webhook token safely with 404', async () => {
      const res = await request(app)
        .post('/api/workflows/triggers/webhook/\' OR 1=1 --')
        .send({ data: 'attack' });

      assert.strictEqual(res.status, 404);
    });

    it('ATTACK-2.4: Malformed corrupt JSON payload returns 400 MALFORMED_JSON_PAYLOAD without crashing server', async () => {
      const tenant = await registerTenant('adv2_4@corp.com');

      const res = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .set('Content-Type', 'application/json')
        .send('{"name": "Bad JSON", steps: [corrupted syntax');

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'MALFORMED_JSON_PAYLOAD');

      // Confirm server is still alive and responds to health check
      const health = await request(app).get('/health');
      assert.strictEqual(health.status, 200);
      assert.strictEqual(health.body.status, 'ok');
    });

    it('ATTACK-2.5: Rejects file uploads exceeding 15MB limit with 413 PAYLOAD_TOO_LARGE', async () => {
      const tenant = await registerTenant('adv2_5@corp.com');

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'Upload Test Pipeline',
          trigger_type: 'file_upload',
          steps: [{ id: 's1', name: 'Extract', type: 'doc_extraction', order: 1 }]
        });

      // Construct a 16MB file buffer (16 * 1024 * 1024 bytes)
      const hugeBuffer = Buffer.alloc(16 * 1024 * 1024, 0x41); // 'A's

      const res = await request(app)
        .post(`/api/workflows/triggers/upload/${wfRes.body.workflow.id}`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .attach('file', hugeBuffer, 'massive_doc.txt');

      assert.strictEqual(res.status, 413);
      assert.strictEqual(res.body.error, 'PAYLOAD_TOO_LARGE');
      assert.match(res.body.message, /exceeds maximum limit of 15MB/i);
    });

    it('ATTACK-2.6: Rejects unsupported MIME types (e.g. image/png, application/x-dosexec) with 415 UNSUPPORTED_MEDIA_TYPE', async () => {
      const tenant = await registerTenant('adv2_6@corp.com');

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'Upload MIME Check Pipeline',
          trigger_type: 'file_upload',
          steps: [{ id: 's1', name: 'Extract', type: 'doc_extraction', order: 1 }]
        });

      const res = await request(app)
        .post(`/api/workflows/triggers/upload/${wfRes.body.workflow.id}`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
          filename: 'malicious.png',
          contentType: 'image/png'
        });

      assert.strictEqual(res.status, 415);
      assert.strictEqual(res.body.error, 'UNSUPPORTED_MEDIA_TYPE');
      assert.match(res.body.message, /Unsupported media type: image\/png/i);
    });

    it('ATTACK-2.7: Rejects multipart upload missing file field with 400 MISSING_FILE', async () => {
      const tenant = await registerTenant('adv2_7@corp.com');

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'Empty Upload Pipeline',
          trigger_type: 'file_upload',
          steps: [{ id: 's1', name: 'Extract', type: 'doc_extraction', order: 1 }]
        });

      const res = await request(app)
        .post(`/api/workflows/triggers/upload/${wfRes.body.workflow.id}`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .field('unrelated_field', 'not_a_file');

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'MISSING_FILE');
    });

    it('ATTACK-2.8: Directory traversal in uploaded filename is sanitized with path.basename', async () => {
      const tenant = await registerTenant('adv2_8@corp.com');

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'Path Traversal Upload Pipeline',
          trigger_type: 'file_upload',
          steps: [{ id: 's1', name: 'Extract', type: 'doc_extraction', order: 1 }]
        });

      const res = await request(app)
        .post(`/api/workflows/triggers/upload/${wfRes.body.workflow.id}`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .attach('file', Buffer.from('Safe content', 'utf-8'), '../../../../etc/passwd.txt');

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.fileId);

      // Verify in uploaded_files database table that stored_path has no '../' traversal
      const fileRow = testDb.db
        .prepare('SELECT * FROM uploaded_files WHERE id = ?')
        .get(res.body.fileId);
      assert.ok(fileRow);
      assert.ok(!fileRow.stored_path.includes('../'), 'Path traversal must be stripped from stored_path');
      assert.match(fileRow.stored_path, /^uploads\/file_[a-f0-9]+_passwd\.txt$/);
    });
  });

  /* ========================================================================
   * 3. MID-PIPELINE FAILURES & DEFENSIVE ERROR BOUNDARIES
   * ======================================================================== */
  describe('3. Mid-Pipeline Failures & Defensive Error Boundaries', () => {
    it('ATTACK-3.1: Mid-pipeline failure: Step 1 succeeds, Step 2 throws error, Step 3 skipped, execution marked failed, server does NOT crash', async () => {
      const tenant = await registerTenant('adv3_1@corp.com');

      const pipeline = {
        name: 'Three Step Pipeline with Middle Failure',
        trigger_type: 'manual',
        steps: [
          {
            id: 'step_one',
            name: 'Step 1: Extract Invoices',
            type: 'doc_extraction',
            order: 1,
            config: {}
          },
          {
            id: 'step_two',
            name: 'Step 2: Intentional Failure Step',
            type: 'doc_extraction',
            order: 2,
            config: { fail_intent: true }
          },
          {
            id: 'step_three',
            name: 'Step 3: Should Be Skipped',
            type: 'synthesis',
            order: 3,
            config: { template: 'Never reached' }
          }
        ]
      };

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send(pipeline);

      // Execute workflow
      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({ document_text: 'Invoice #INV-2026-9921 Vendor: ACME Total: $14,250' });

      // Service did not crash; gracefully returned 200 with failed status
      assert.strictEqual(runRes.status, 200);
      assert.strictEqual(runRes.body.execution.status, 'failed');
      assert.ok(runRes.body.execution.error_message);
      assert.match(runRes.body.execution.error_message, /fail_intent: true/i);

      // Verify execution record in DB
      const dbExec = testDb.db
        .prepare('SELECT status, error_message FROM workflow_executions WHERE id = ?')
        .get(runRes.body.execution.id);
      assert.strictEqual(dbExec.status, 'failed');
      assert.match(dbExec.error_message, /fail_intent: true/i);

      // Verify granular step traces in DB
      const traceRes = await request(app)
        .get(`/api/executions/${runRes.body.execution.id}/trace`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id);

      assert.strictEqual(traceRes.status, 200);
      assert.strictEqual(traceRes.body.steps.length, 3);

      const [s1, s2, s3] = traceRes.body.steps;
      // Step 1: success
      assert.strictEqual(s1.step_id, 'step_one');
      assert.strictEqual(s1.status, 'success');
      assert.ok(s1.output_data.fields.invoice_number);

      // Step 2: failed with error details
      assert.strictEqual(s2.step_id, 'step_two');
      assert.strictEqual(s2.status, 'failed');
      assert.match(s2.error_details.message, /fail_intent: true/i);

      // Step 3: skipped
      assert.strictEqual(s3.step_id, 'step_three');
      assert.strictEqual(s3.status, 'skipped');
      assert.strictEqual(s3.output_data, null);

      // Confirm subsequent independent requests still succeed flawlessly
      const health = await request(app).get('/health');
      assert.strictEqual(health.status, 200);
    });

    it('ATTACK-3.2: AI step simulated timeout sets step to failed and terminates pipeline safely', async () => {
      const tenant = await registerTenant('adv3_2@corp.com');

      const timeoutPipeline = {
        name: 'Simulated Timeout Pipeline',
        trigger_type: 'manual',
        steps: [
          {
            id: 'timeout_step',
            name: 'Slow Classification',
            type: 'classification',
            order: 1,
            config: { simulate_timeout: true, categories: ['CatA', 'CatB'] }
          },
          {
            id: 'after_timeout',
            name: 'Downstream Step',
            type: 'synthesis',
            order: 2,
            config: {}
          }
        ]
      };

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send(timeoutPipeline);

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
      assert.strictEqual(traceRes.body.steps[0].error_details.code, 'AI_TIMEOUT_ERROR');
      assert.strictEqual(traceRes.body.steps[1].status, 'skipped');
    });
  });

  /* ========================================================================
   * 4. CROSS-TENANT IDOR ATTACK MATRIX
   * ======================================================================== */
  describe('4. Cross-Tenant IDOR Attack Matrix', () => {
    let tenantA;
    let tenantB;
    let workflowA;
    let executionA;

    beforeEach(async () => {
      tenantA = await registerTenant('victim_tenant_a@firm.com', 'Tenant A User', 'Tenant A Firm');
      tenantB = await registerTenant('attacker_tenant_b@firm.com', 'Tenant B User', 'Tenant B Firm');

      // Tenant A creates workflow
      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenantA.authHeader)
        .set('x-workspace-id', tenantA.workspace.id)
        .send({
          name: 'Confidential Finance Workflow A',
          description: 'Tenant A internal financial pipeline',
          trigger_type: 'manual',
          steps: [{ id: 's1', name: 'Extract', type: 'doc_extraction', order: 1 }]
        });
      workflowA = wfRes.body.workflow;

      // Tenant A executes workflow
      const runRes = await request(app)
        .post(`/api/workflows/${workflowA.id}/run`)
        .set('Authorization', tenantA.authHeader)
        .set('x-workspace-id', tenantA.workspace.id)
        .send({ document_text: 'Confidential Financial Report 2026' });
      executionA = runRes.body.execution;
    });

    it('IDOR-4.1: Tenant B cannot read Tenant A workflow definition via GET /api/workflows/:id (404)', async () => {
      const res = await request(app)
        .get(`/api/workflows/${workflowA.id}`)
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantB.workspace.id);

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'WORKFLOW_NOT_FOUND');
    });

    it('IDOR-4.2: Tenant B cannot modify Tenant A workflow definition via PUT /api/workflows/:id (404)', async () => {
      const res = await request(app)
        .put(`/api/workflows/${workflowA.id}`)
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantB.workspace.id)
        .send({ name: 'Tampered by Tenant B' });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'WORKFLOW_NOT_FOUND');

      // Verify Tenant A workflow is untouched
      const verify = await request(app)
        .get(`/api/workflows/${workflowA.id}`)
        .set('Authorization', tenantA.authHeader)
        .set('x-workspace-id', tenantA.workspace.id);
      assert.strictEqual(verify.body.workflow.name, 'Confidential Finance Workflow A');
    });

    it('IDOR-4.3: Tenant B cannot delete Tenant A workflow definition via DELETE /api/workflows/:id (404)', async () => {
      const res = await request(app)
        .delete(`/api/workflows/${workflowA.id}`)
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantB.workspace.id);

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'WORKFLOW_NOT_FOUND');

      // Verify Tenant A workflow still exists
      const verify = await request(app)
        .get(`/api/workflows/${workflowA.id}`)
        .set('Authorization', tenantA.authHeader)
        .set('x-workspace-id', tenantA.workspace.id);
      assert.strictEqual(verify.status, 200);
    });

    it('IDOR-4.4: Tenant B cannot trigger Tenant A workflow via POST /api/workflows/:id/run (404)', async () => {
      const res = await request(app)
        .post(`/api/workflows/${workflowA.id}/run`)
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantB.workspace.id)
        .send({ document_text: 'Unauthorized trigger attempt' });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'WORKFLOW_NOT_FOUND');
    });

    it('IDOR-4.5: Tenant B cannot upload file to Tenant A workflow via POST /api/workflows/triggers/upload/:id (404)', async () => {
      const res = await request(app)
        .post(`/api/workflows/triggers/upload/${workflowA.id}`)
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantB.workspace.id)
        .attach('file', Buffer.from('Illegal document', 'utf-8'), 'illegal.txt');

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'WORKFLOW_NOT_FOUND');
    });

    it('IDOR-4.6: Tenant B cannot read Tenant A execution summary via GET /api/executions/:id (404)', async () => {
      const res = await request(app)
        .get(`/api/executions/${executionA.id}`)
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantB.workspace.id);

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'EXECUTION_NOT_FOUND');
    });

    it('IDOR-4.7: Tenant B cannot read Tenant A granular step trace via GET /api/executions/:id/trace (404)', async () => {
      const res = await request(app)
        .get(`/api/executions/${executionA.id}/trace`)
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantB.workspace.id);

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'EXECUTION_NOT_FOUND');
    });

    it('IDOR-4.8: Querying GET /api/executions?workflow_id=<Tenant_A_ID> as Tenant B returns empty list with zero leakage', async () => {
      const res = await request(app)
        .get(`/api/executions?workflow_id=${workflowA.id}`)
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantB.workspace.id);

      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.executions));
      assert.strictEqual(res.body.executions.length, 0, 'Must never leak foreign executions');
    });
  });

  /* ========================================================================
   * 5. BLANK, UNICODE DOCUMENTS & EXTREME INPUTS
   * ======================================================================== */
  describe('5. Blank, Unicode Documents & Extreme Inputs', () => {
    it('INPUT-5.1: Completely blank string ("") document completes gracefully with EMPTY_DOCUMENT warning', async () => {
      const tenant = await registerTenant('adv5_1@corp.com');

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'Blank Document Handler Pipeline',
          trigger_type: 'manual',
          steps: [{ id: 's1', name: 'Extract', type: 'doc_extraction', order: 1 }]
        });

      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({ document_text: '' });

      assert.strictEqual(runRes.status, 200);
      assert.strictEqual(runRes.body.execution.status, 'completed');

      const traceRes = await request(app)
        .get(`/api/executions/${runRes.body.execution.id}/trace`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id);

      assert.strictEqual(traceRes.body.steps[0].status, 'success');
      assert.strictEqual(traceRes.body.steps[0].output_data.warning, 'EMPTY_DOCUMENT');
    });

    it('INPUT-5.2: Whitespace-only string ("   \\t\\r\\n   ") produces EMPTY_DOCUMENT warning without error', async () => {
      const tenant = await registerTenant('adv5_2@corp.com');

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'Whitespace Document Pipeline',
          trigger_type: 'manual',
          steps: [{ id: 's1', name: 'Extract', type: 'doc_extraction', order: 1 }]
        });

      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({ document_text: '   \t\r\n   \n   ' });

      assert.strictEqual(runRes.status, 200);
      assert.strictEqual(runRes.body.execution.status, 'completed');

      const traceRes = await request(app)
        .get(`/api/executions/${runRes.body.execution.id}/trace`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id);

      assert.strictEqual(traceRes.body.steps[0].output_data.warning, 'EMPTY_DOCUMENT');
    });

    it('INPUT-5.3: Multilingual Unicode & Emoji content processed accurately without encoding corruption', async () => {
      const tenant = await registerTenant('adv5_3@corp.com');

      const unicodeText = `
        請求書 #INV-JP-9012
        ベンダー: 株式会社グローバルソリューションズ
        合計: ¥500,000
        ملاحظة: فاتورة خاصة بالتطوير البرمجي
        Special symbols: 💸 🚀 🔥 & ∑(x^2) = 42
        Accents: Facture générée pour l'équipe Développement & Qualité
      `;

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'Multilingual Unicode Pipeline',
          trigger_type: 'manual',
          steps: [
            { id: 's1', name: 'Extract', type: 'doc_extraction', order: 1 },
            { id: 's2', name: 'Synthesize', type: 'synthesis', order: 2, config: { template: 'Processed: {{steps.s1.output.text}}' } }
          ]
        });

      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({ document_text: unicodeText });

      assert.strictEqual(runRes.status, 200);
      assert.strictEqual(runRes.body.execution.status, 'completed');

      const traceRes = await request(app)
        .get(`/api/executions/${runRes.body.execution.id}/trace`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id);

      assert.strictEqual(traceRes.body.steps[0].status, 'success');
      assert.ok(traceRes.body.steps[1].output_data.summary.includes('株式会社グローバルソリューションズ'));
      assert.ok(traceRes.body.steps[1].output_data.summary.includes('💸 🚀 🔥'));
    });

    it('INPUT-5.4: Large text payload (250KB) executes within bounds and records trace successfully', async () => {
      const tenant = await registerTenant('adv5_4@corp.com');

      // Create a 250KB textual payload
      const largeText = 'INVOICE #BULK-TEST-1 Vendor: MegaCorp Total: $99,000\n' +
        'Detail line items:\n' +
        'Product SKU-A100 Enterprise Software License: $1,000\n'.repeat(4000);

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'High Capacity Document Processing Pipeline',
          trigger_type: 'manual',
          steps: [{ id: 's1', name: 'Extract Large Doc', type: 'doc_extraction', order: 1 }]
        });

      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({ document_text: largeText });

      assert.strictEqual(runRes.status, 200);
      assert.strictEqual(runRes.body.execution.status, 'completed');
    });

    it('INPUT-5.5: Non-string and nested structured payloads in triggers are parsed without crashing', async () => {
      const tenant = await registerTenant('adv5_5@corp.com');

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'Structured Payload Pipeline',
          trigger_type: 'manual',
          steps: [
            {
              id: 's1',
              name: 'Extract Objects',
              type: 'doc_extraction',
              order: 1,
              config: { source: '{{trigger.payload}}' }
            }
          ]
        });

      const runRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          payload: {
            numeric_code: 98765,
            boolean_flag: true,
            nested_metadata: { tier: 'enterprise', active: true },
            list_items: ['item1', 'item2']
          }
        });

      assert.strictEqual(runRes.status, 200);
      assert.strictEqual(runRes.body.execution.status, 'completed');
    });
  });

  /* ========================================================================
   * 6. QUOTA USAGE METERING & RATE BOUNDARY ENFORCEMENT
   * ======================================================================== */
  describe('6. Quota Usage Metering & Boundary Enforcement', () => {
    it('QUOTA-6.1: Enforces Free tier ceiling of 50 runs and blocks run 51 with 429 QUOTA_EXCEEDED', async () => {
      const tenant = await registerTenant('quota_stress@corp.com');

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'Quota Bounded Pipeline',
          trigger_type: 'manual',
          steps: [{ id: 's1', name: 'Extract', type: 'doc_extraction', order: 1 }]
        });

      // Advance usage meter to exactly 50/50
      testDb.db
        .prepare('UPDATE usage_meters SET runs_count = 50 WHERE workspace_id = ?')
        .run(tenant.workspace.id);

      // Attempt execution 51
      const blockedRes = await request(app)
        .post(`/api/workflows/${wfRes.body.workflow.id}/run`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({ document_text: 'Invoice text' });

      assert.strictEqual(blockedRes.status, 429);
      assert.strictEqual(blockedRes.body.error, 'QUOTA_EXCEEDED');
      assert.strictEqual(blockedRes.body.current_usage, 50);
      assert.strictEqual(blockedRes.body.limit, 50);

      // Verify no execution record was inserted into workflow_executions
      const execCount = testDb.db
        .prepare('SELECT COUNT(*) as cnt FROM workflow_executions WHERE workspace_id = ?')
        .get(tenant.workspace.id);
      assert.strictEqual(execCount.cnt, 0);
    });
  });

  /* ========================================================================
   * 7. REMEDIATION SUITE: TRACELOGGER POLYMORPHISM & GENUINE TRIGGERS
   * ======================================================================== */
  describe('7. Remediation Verification Suite', () => {
    it('REMED-1.1: TraceLogger.recordStepFailure works with positional arguments (logId, errorDetails, durationMs, db)', async () => {
      const tenant = await registerTenant('remed1_1@corp.com');

      testDb.db.prepare("INSERT INTO workflows (id, workspace_id, name, trigger_type, steps) VALUES ('wf_remed_pos', ?, 'test', 'manual', '[]')").run(tenant.workspace.id);
      testDb.db.prepare("INSERT INTO workflow_executions (id, workspace_id, workflow_id, trigger_type, status) VALUES ('exec_remed_pos', ?, 'wf_remed_pos', 'manual', 'running')").run(tenant.workspace.id);

      const logId = TraceLogger.startStepLog(
        {
          executionId: 'exec_remed_pos',
          workspaceId: tenant.workspace.id,
          stepId: 'step_pos',
          stepName: 'Positional Test Step',
          stepType: 'doc_extraction',
          stepOrder: 1,
          inputData: { test: true }
        },
        testDb.db
      );

      // Positional invocation (as called by runner.js)
      TraceLogger.recordStepFailure(
        logId,
        { code: 'POSITIONAL_TEST_ERROR', message: 'Testing positional error trace' },
        142,
        testDb.db
      );

      const row = testDb.db
        .prepare('SELECT * FROM step_execution_logs WHERE id = ?')
        .get(logId);

      assert.ok(row);
      assert.strictEqual(row.status, 'failed');
      assert.strictEqual(row.duration_ms, 142);
      assert.ok(row.completed_at);
      const parsedErr = JSON.parse(row.error_details);
      assert.strictEqual(parsedErr.code, 'POSITIONAL_TEST_ERROR');
      assert.strictEqual(parsedErr.message, 'Testing positional error trace');
    });

    it('REMED-1.2: TraceLogger.recordStepSuccess works with positional arguments', async () => {
      const tenant = await registerTenant('remed1_2@corp.com');

      testDb.db.prepare("INSERT INTO workflows (id, workspace_id, name, trigger_type, steps) VALUES ('wf_remed_opt', ?, 'test', 'manual', '[]')").run(tenant.workspace.id);
      testDb.db.prepare("INSERT INTO workflow_executions (id, workspace_id, workflow_id, trigger_type, status) VALUES ('exec_remed_opt', ?, 'wf_remed_opt', 'manual', 'running')").run(tenant.workspace.id);

      const logId = TraceLogger.startStepLog(
        {
          executionId: 'exec_remed_opt',
          workspaceId: tenant.workspace.id,
          stepId: 'step_opt',
          stepName: 'Options Test Step',
          stepType: 'classification',
          stepOrder: 1,
          inputData: {}
        },
        testDb.db
      );

      TraceLogger.recordStepSuccess(
        logId,
        { foo: 'bar' },
        256,
        testDb.db
      );

      const row = testDb.db
        .prepare('SELECT * FROM step_execution_logs WHERE id = ?')
        .get(logId);

      assert.ok(row);
      assert.strictEqual(row.status, 'success');
      assert.strictEqual(row.duration_ms, 256);
      const parsedOut = JSON.parse(row.output_data);
      assert.strictEqual(parsedOut.foo, 'bar');
    });

    it('REMED-1.3: TraceLogger.recordStepFailure handles Native Error instances safely', async () => {
      const tenant = await registerTenant('remed1_3@corp.com');

      testDb.db.prepare("INSERT INTO workflows (id, workspace_id, name, trigger_type, steps) VALUES ('wf_remed_err', ?, 'test', 'manual', '[]')").run(tenant.workspace.id);
      testDb.db.prepare("INSERT INTO workflow_executions (id, workspace_id, workflow_id, trigger_type, status) VALUES ('exec_remed_err', ?, 'wf_remed_err', 'manual', 'running')").run(tenant.workspace.id);

      const logId = TraceLogger.startStepLog(
        {
          executionId: 'exec_remed_err',
          workspaceId: tenant.workspace.id,
          stepId: 'step_err',
          stepName: 'Error Class Step',
          stepType: 'synthesis',
          stepOrder: 1,
          inputData: {}
        },
        testDb.db
      );

      TraceLogger.recordStepFailure(
        logId,
        new Error('Unexpected runtime exception'),
        75,
        testDb.db
      );

      const row = testDb.db
        .prepare('SELECT * FROM step_execution_logs WHERE id = ?')
        .get(logId);

      assert.ok(row);
      assert.strictEqual(row.status, 'failed');
      assert.strictEqual(row.duration_ms, 75);
      const parsedErr = JSON.parse(row.error_details);
      assert.strictEqual(parsedErr.message, 'Unexpected runtime exception');
    });

    it('REMED-2.1: Manual trigger returns 404 WORKFLOW_NOT_FOUND without auto-provisioning for non-existent workflow', async () => {
      const tenant = await registerTenant('remed2_1@corp.com');

      const res = await request(app)
        .post('/api/workflows/triggers/manual')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({ workflow_id: 'non_existent_wf_99999' });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'WORKFLOW_NOT_FOUND');

      // Verify no row was created in workflows table
      const count = testDb.db
        .prepare('SELECT COUNT(*) as cnt FROM workflows WHERE workspace_id = ?')
        .get(tenant.workspace.id);
      assert.strictEqual(count.cnt, 0);
    });

    it('REMED-2.2: Manual trigger rejects former shortcut IDs (sample_wf, test_wf, sample_id) with 404', async () => {
      const tenant = await registerTenant('remed2_2@corp.com');

      for (const legacyId of ['sample_wf', 'test_wf', 'sample_id', 'test_workflow']) {
        const res = await request(app)
          .post('/api/workflows/triggers/manual')
          .set('Authorization', tenant.authHeader)
          .set('x-workspace-id', tenant.workspace.id)
          .send({ workflow_id: legacyId });

        assert.strictEqual(res.status, 404, `Legacy id ${legacyId} should return 404`);
        assert.strictEqual(res.body.error, 'WORKFLOW_NOT_FOUND');
      }

      // Verify no workflows were auto-inserted
      const count = testDb.db
        .prepare('SELECT COUNT(*) as cnt FROM workflows WHERE workspace_id = ?')
        .get(tenant.workspace.id);
      assert.strictEqual(count.cnt, 0);
    });

    it('REMED-2.3: Manual trigger rejects request missing workflow_id with 400 MISSING_WORKFLOW_ID', async () => {
      const tenant = await registerTenant('remed2_3@corp.com');

      const res = await request(app)
        .post('/api/workflows/triggers/manual')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({ payload: { key: 'val' } });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'MISSING_WORKFLOW_ID');
    });

    it('REMED-2.4: File upload trigger rejects former shortcut IDs (test_wf_id, sample_wf) with 404', async () => {
      const tenant = await registerTenant('remed2_4@corp.com');

      for (const legacyId of ['test_wf_id', 'sample_wf', 'random_missing_wf']) {
        const res = await request(app)
          .post(`/api/workflows/triggers/upload/${legacyId}`)
          .set('Authorization', tenant.authHeader)
          .set('x-workspace-id', tenant.workspace.id)
          .attach('file', Buffer.from('Invoice text', 'utf-8'), 'doc.txt');

        assert.strictEqual(res.status, 404, `Upload to ${legacyId} should return 404`);
        assert.strictEqual(res.body.error, 'WORKFLOW_NOT_FOUND');
      }

      // Verify no workflows were auto-inserted
      const count = testDb.db
        .prepare('SELECT COUNT(*) as cnt FROM workflows WHERE workspace_id = ?')
        .get(tenant.workspace.id);
      assert.strictEqual(count.cnt, 0);
    });

    it('REMED-3.1: Multipart streaming byte limit enforces 15MB ceiling and returns 413 PAYLOAD_TOO_LARGE', async () => {
      const tenant = await registerTenant('remed3_1@corp.com');

      const wfRes = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'Streaming Limit Workflow',
          trigger_type: 'file_upload',
          steps: [{ id: 's1', name: 'Extract', type: 'doc_extraction', order: 1 }]
        });

      // Construct 15.5MB buffer (exceeding 15 * 1024 * 1024)
      const oversizedBuffer = Buffer.alloc(Math.floor(15.5 * 1024 * 1024), 0x5a); // 'Z's

      const res = await request(app)
        .post(`/api/workflows/triggers/upload/${wfRes.body.workflow.id}`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .attach('file', oversizedBuffer, 'oversized.txt');

      assert.strictEqual(res.status, 413);
      assert.strictEqual(res.body.error, 'PAYLOAD_TOO_LARGE');
      assert.match(res.body.message, /exceeds maximum limit of 15MB/i);
    });
  });
});
