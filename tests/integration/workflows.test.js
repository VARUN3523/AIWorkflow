import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../src/app.js';
import { setupTestDb } from '../helpers/test_db.js';

describe('Workflow Builder Integration Tests (R1: Features F-WF-01 to F-WF-04)', () => {
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

  const sampleWorkflowPayload = {
    name: 'Invoice Processing & Routing',
    description: 'Extracts invoices, categorizes expenses, and synthesizes briefs',
    trigger_type: 'manual',
    trigger_config: { allowed_mime_types: ['application/pdf', 'text/plain'] },
    steps: [
      {
        id: 's1_extract',
        name: 'Extract Invoice Entities',
        type: 'doc_extraction',
        order: 1,
        config: { fields: ['invoice_number', 'vendor_name', 'total_amount'] }
      },
      {
        id: 's2_classify',
        name: 'Classify Expense Level',
        type: 'classification',
        order: 2,
        config: {
          input: '{{steps.s1_extract.output.fields.total_amount}}',
          categories: ['Low Expense (<$500)', 'Standard Expense ($500-$5k)', 'High-Value Enterprise Expense (>$5k)']
        }
      },
      {
        id: 's3_synth',
        name: 'Synthesize CFO Brief',
        type: 'synthesis',
        order: 3,
        config: {
          template: 'Invoice for {{steps.s1_extract.output.fields.vendor_name}} with category {{steps.s2_classify.output.category}}'
        }
      }
    ]
  };

  // =========================================================================
  // 1. Workflow CRUD Operations
  // =========================================================================
  describe('1. Workflow CRUD Operations', () => {
    it('creates a new workflow definition with valid multi-step pipeline (201 Created)', async () => {
      const tenant = await registerTenant('wf_creator@corp.com');

      const res = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send(sampleWorkflowPayload);

      assert.strictEqual(res.status, 201);
      assert.ok(res.body.workflow);
      assert.ok(res.body.workflow.id.startsWith('wf_'));
      assert.strictEqual(res.body.workflow.name, sampleWorkflowPayload.name);
      assert.strictEqual(res.body.workflow.workspace_id, tenant.workspace.id);
      assert.strictEqual(res.body.workflow.steps.length, 3);
      assert.strictEqual(res.body.workflow.status, 'active');
    });

    it('retrieves an existing workflow definition by ID with complete schema', async () => {
      const tenant = await registerTenant('wf_getter@corp.com');

      const created = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send(sampleWorkflowPayload);

      const res = await request(app)
        .get(`/api/workflows/${created.body.workflow.id}`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.workflow.id, created.body.workflow.id);
      assert.strictEqual(res.body.workflow.name, sampleWorkflowPayload.name);
      assert.strictEqual(res.body.workflow.steps[0].type, 'doc_extraction');
    });

    it('lists all workflows belonging to the active workspace', async () => {
      const tenant = await registerTenant('wf_lister@corp.com');

      // Create two workflows
      await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({ ...sampleWorkflowPayload, name: 'Workflow A' });

      await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({ ...sampleWorkflowPayload, name: 'Workflow B' });

      const res = await request(app)
        .get('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id);

      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.workflows));
      assert.strictEqual(res.body.workflows.length, 2);
    });

    it('updates workflow name, description, status, and steps', async () => {
      const tenant = await registerTenant('wf_updater@corp.com');

      const created = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send(sampleWorkflowPayload);

      const res = await request(app)
        .put(`/api/workflows/${created.body.workflow.id}`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'Renamed Pipeline',
          status: 'paused',
          description: 'Paused for audit'
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.workflow.name, 'Renamed Pipeline');
      assert.strictEqual(res.body.workflow.status, 'paused');
      assert.strictEqual(res.body.workflow.description, 'Paused for audit');
    });

    it('deletes workflow and confirms subsequent GET returns 404', async () => {
      const tenant = await registerTenant('wf_deleter@corp.com');

      const created = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send(sampleWorkflowPayload);

      const delRes = await request(app)
        .delete(`/api/workflows/${created.body.workflow.id}`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id);

      assert.strictEqual(delRes.status, 200);
      assert.strictEqual(delRes.body.success, true);

      // Verify workflow is gone
      const getRes = await request(app)
        .get(`/api/workflows/${created.body.workflow.id}`)
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id);

      assert.strictEqual(getRes.status, 404);
      assert.strictEqual(getRes.body.error, 'WORKFLOW_NOT_FOUND');
    });
  });

  // =========================================================================
  // 2. Schema Validation & Boundary Handling
  // =========================================================================
  describe('2. Schema Validation and Boundary Handling', () => {
    it('rejects workflow creation with empty or missing name (400 Bad Request)', async () => {
      const tenant = await registerTenant('val_name@corp.com');

      const res = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: '   ',
          steps: sampleWorkflowPayload.steps
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'INVALID_NAME');
    });

    it('rejects workflow creation with zero steps (400 Bad Request)', async () => {
      const tenant = await registerTenant('val_steps@corp.com');

      const res = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'Zero Steps Workflow',
          steps: []
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'INVALID_STEPS');
    });

    it('rejects workflow creation with unsupported step processor type (400 Bad Request)', async () => {
      const tenant = await registerTenant('val_type@corp.com');

      const res = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          name: 'Unsupported Step Type Pipeline',
          steps: [
            {
              id: 's1',
              name: 'Bad Step',
              type: 'telepathic_neural_sync',
              order: 1
            }
          ]
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'INVALID_STEP_TYPE');
    });

    it('safely handles workflow names containing HTML/script tags without XSS execution', async () => {
      const tenant = await registerTenant('val_xss@corp.com');
      const xssName = '<script>alert("XSS")</script> Secure Extraction Pipeline';

      const res = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          ...sampleWorkflowPayload,
          name: xssName
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.workflow.name, xssName);
    });

    it('safely accepts long workflow names without database buffer overflow', async () => {
      const tenant = await registerTenant('val_long@corp.com');
      const longName = 'Enterprise AI Document Processing Pipeline '.repeat(5);

      const res = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenant.authHeader)
        .set('x-workspace-id', tenant.workspace.id)
        .send({
          ...sampleWorkflowPayload,
          name: longName
        });

      assert.strictEqual(res.status, 201);
      assert.ok(res.body.workflow.id);
    });
  });

  // =========================================================================
  // 3. Multi-Tenant Scoping & IDOR Defense
  // =========================================================================
  describe('3. Multi-Tenant Scoping & IDOR Defense', () => {
    it('strictly prevents Tenant B from reading Tenant A workflow (404 Not Found)', async () => {
      const tenantA = await registerTenant('tenantA@firm.com');
      const tenantB = await registerTenant('tenantB@firm.com');

      const created = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenantA.authHeader)
        .set('x-workspace-id', tenantA.workspace.id)
        .send(sampleWorkflowPayload);

      // Tenant B tries to fetch Tenant A's workflow
      const res = await request(app)
        .get(`/api/workflows/${created.body.workflow.id}`)
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantB.workspace.id);

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'WORKFLOW_NOT_FOUND');
    });

    it('strictly prevents Tenant B from updating Tenant A workflow (404 Not Found)', async () => {
      const tenantA = await registerTenant('tenantA_up@firm.com');
      const tenantB = await registerTenant('tenantB_up@firm.com');

      const created = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenantA.authHeader)
        .set('x-workspace-id', tenantA.workspace.id)
        .send(sampleWorkflowPayload);

      // Tenant B tries to update Tenant A's workflow
      const res = await request(app)
        .put(`/api/workflows/${created.body.workflow.id}`)
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantB.workspace.id)
        .send({ name: 'Hacked by Tenant B' });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'WORKFLOW_NOT_FOUND');

      // Verify original workflow name is unchanged
      const verifyRes = await request(app)
        .get(`/api/workflows/${created.body.workflow.id}`)
        .set('Authorization', tenantA.authHeader)
        .set('x-workspace-id', tenantA.workspace.id);
      assert.strictEqual(verifyRes.body.workflow.name, sampleWorkflowPayload.name);
    });

    it('strictly prevents Tenant B from deleting Tenant A workflow (404 Not Found)', async () => {
      const tenantA = await registerTenant('tenantA_del@firm.com');
      const tenantB = await registerTenant('tenantB_del@firm.com');

      const created = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenantA.authHeader)
        .set('x-workspace-id', tenantA.workspace.id)
        .send(sampleWorkflowPayload);

      // Tenant B tries to delete Tenant A's workflow
      const res = await request(app)
        .delete(`/api/workflows/${created.body.workflow.id}`)
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantB.workspace.id);

      assert.strictEqual(res.status, 404);

      // Verify Tenant A workflow still exists
      const verifyRes = await request(app)
        .get(`/api/workflows/${created.body.workflow.id}`)
        .set('Authorization', tenantA.authHeader)
        .set('x-workspace-id', tenantA.workspace.id);
      assert.strictEqual(verifyRes.status, 200);
    });

    it('ensures Tenant B workflow catalog never contains Tenant A workflows', async () => {
      const tenantA = await registerTenant('tenantA_cat@firm.com');
      const tenantB = await registerTenant('tenantB_cat@firm.com');

      const createdA = await request(app)
        .post('/api/workflows')
        .set('Authorization', tenantA.authHeader)
        .set('x-workspace-id', tenantA.workspace.id)
        .send(sampleWorkflowPayload);

      const listBRes = await request(app)
        .get('/api/workflows')
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantB.workspace.id);

      assert.strictEqual(listBRes.status, 200);
      const containsA = listBRes.body.workflows.some((w) => w.id === createdA.body.workflow.id);
      assert.strictEqual(containsA, false, 'Tenant B listing must never leak Tenant A workflow');
    });

    it('rejects foreign x-workspace-id header tampering with 403 Forbidden', async () => {
      const tenantA = await registerTenant('tenantA_head@firm.com');
      const tenantB = await registerTenant('tenantB_head@firm.com');

      // Tenant B sends Tenant A's workspace ID in x-workspace-id header
      const res = await request(app)
        .get('/api/workflows')
        .set('Authorization', tenantB.authHeader)
        .set('x-workspace-id', tenantA.workspace.id);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, 'FORBIDDEN');
    });
  });
});
