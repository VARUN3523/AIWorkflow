import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../src/app.js';
import { setupTestDb } from '../helpers/test_db.js';

describe('Multi-Tenant & RBAC Integration Tests (R2: Isolation & Access Control)', () => {
  let testDb;

  beforeEach(() => {
    testDb = setupTestDb();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  // Helper to create a user and return details
  async function registerUser(email, fullName, wsName) {
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

  describe('Workspace Management CRUD', () => {
    it('allows authenticated users to create and list workspaces', async () => {
      const tenantA = await registerUser('alice@tenant-a.com', 'Alice A', 'Company A');

      // Create a second workspace for Tenant A
      const createRes = await request(app)
        .post('/api/workspaces')
        .set('Authorization', `Bearer ${tenantA.token}`)
        .send({ name: 'Company A - Branch 2' });

      assert.strictEqual(createRes.status, 201);
      assert.strictEqual(createRes.body.workspace.name, 'Company A - Branch 2');
      assert.strictEqual(createRes.body.workspace.role, 'owner');

      // List workspaces for Tenant A
      const listRes = await request(app)
        .get('/api/workspaces')
        .set('Authorization', `Bearer ${tenantA.token}`);

      assert.strictEqual(listRes.status, 200);
      assert.strictEqual(listRes.body.workspaces.length, 2);
    });

    it('validates workspace creation name', async () => {
      const tenantA = await registerUser('alice2@tenant-a.com', 'Alice A', 'Company A');

      const res = await request(app)
        .post('/api/workspaces')
        .set('Authorization', `Bearer ${tenantA.token}`)
        .send({ name: '   ' });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'INVALID_WORKSPACE_NAME');
    });

    it('allows owner or admin to update workspace name', async () => {
      const tenantA = await registerUser('owner@company.com', 'Owner', 'Old Name');

      const updateRes = await request(app)
        .put(`/api/workspaces/${tenantA.workspace.id}`)
        .set('Authorization', `Bearer ${tenantA.token}`)
        .send({ name: 'New Brand Name' });

      assert.strictEqual(updateRes.status, 200);
      assert.strictEqual(updateRes.body.workspace.name, 'New Brand Name');
    });
  });

  describe('Tenant Isolation (IDOR Defense)', () => {
    it('strictly prevents Tenant B from reading Tenant A workspace (returns 404)', async () => {
      const tenantA = await registerUser('alice@tenant-a.com', 'Alice A', 'Tenant A Org');
      const tenantB = await registerUser('bob@tenant-b.com', 'Bob B', 'Tenant B Org');

      // Tenant B tries to read Tenant A's workspace
      const res = await request(app)
        .get(`/api/workspaces/${tenantA.workspace.id}`)
        .set('Authorization', `Bearer ${tenantB.token}`);

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'WORKSPACE_NOT_FOUND');
    });

    it('strictly prevents Tenant B from updating Tenant A workspace (returns 404)', async () => {
      const tenantA = await registerUser('alice@tenant-a.com', 'Alice A', 'Tenant A Org');
      const tenantB = await registerUser('bob@tenant-b.com', 'Bob B', 'Tenant B Org');

      const res = await request(app)
        .put(`/api/workspaces/${tenantA.workspace.id}`)
        .set('Authorization', `Bearer ${tenantB.token}`)
        .send({ name: 'Hacked Workspace Name' });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'WORKSPACE_NOT_FOUND');
    });

    it('strictly prevents Tenant B from deleting Tenant A workspace (returns 404)', async () => {
      const tenantA = await registerUser('alice@tenant-a.com', 'Alice A', 'Tenant A Org');
      const tenantB = await registerUser('bob@tenant-b.com', 'Bob B', 'Tenant B Org');

      const res = await request(app)
        .delete(`/api/workspaces/${tenantA.workspace.id}`)
        .set('Authorization', `Bearer ${tenantB.token}`);

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'WORKSPACE_NOT_FOUND');
    });

    it('strictly prevents Tenant B from listing Tenant A members (returns 404)', async () => {
      const tenantA = await registerUser('alice@tenant-a.com', 'Alice A', 'Tenant A Org');
      const tenantB = await registerUser('bob@tenant-b.com', 'Bob B', 'Tenant B Org');

      const res = await request(app)
        .get(`/api/workspaces/${tenantA.workspace.id}/members`)
        .set('Authorization', `Bearer ${tenantB.token}`);

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'WORKSPACE_NOT_FOUND');
    });

    it('rejects foreign x-workspace-id header tampering with 403 Forbidden', async () => {
      const tenantA = await registerUser('alice@tenant-a.com', 'Alice A', 'Tenant A Org');
      const tenantB = await registerUser('bob@tenant-b.com', 'Bob B', 'Tenant B Org');

      // Tenant B tries to switch session or access with Tenant A workspace header
      const res = await request(app)
        .post(`/api/workspaces/${tenantA.workspace.id}/switch`)
        .set('Authorization', `Bearer ${tenantB.token}`);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, 'FORBIDDEN');
    });
  });

  describe('Memberships & RBAC Permissions', () => {
    it('allows owner to add member and permits new member access', async () => {
      const tenantA = await registerUser('alice@tenant-a.com', 'Alice A', 'Tenant A Org');
      const userCharlie = await registerUser('charlie@collab.com', 'Charlie C', 'Charlie Personal');

      // Alice invites Charlie as 'member'
      const inviteRes = await request(app)
        .post(`/api/workspaces/${tenantA.workspace.id}/members`)
        .set('Authorization', `Bearer ${tenantA.token}`)
        .send({
          email: 'charlie@collab.com',
          role: 'member',
        });

      assert.strictEqual(inviteRes.status, 201);
      assert.strictEqual(inviteRes.body.member.email, 'charlie@collab.com');
      assert.strictEqual(inviteRes.body.member.role, 'member');

      // Charlie can now access Tenant A's workspace
      const accessRes = await request(app)
        .get(`/api/workspaces/${tenantA.workspace.id}`)
        .set('Authorization', `Bearer ${userCharlie.token}`);

      assert.strictEqual(accessRes.status, 200);
      assert.strictEqual(accessRes.body.workspace.id, tenantA.workspace.id);
      assert.strictEqual(accessRes.body.workspace.role, 'member');
    });

    it('prevents inviting non-existent email with 404', async () => {
      const tenantA = await registerUser('alice@tenant-a.com', 'Alice A', 'Tenant A Org');

      const res = await request(app)
        .post(`/api/workspaces/${tenantA.workspace.id}/members`)
        .set('Authorization', `Bearer ${tenantA.token}`)
        .send({
          email: 'nobody@nowhere.com',
          role: 'member',
        });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'USER_NOT_FOUND');
    });

    it('prevents duplicate membership with 409 Conflict', async () => {
      const tenantA = await registerUser('alice@tenant-a.com', 'Alice A', 'Tenant A Org');
      const userCharlie = await registerUser('charlie@collab.com', 'Charlie C', 'Charlie Personal');

      await request(app)
        .post(`/api/workspaces/${tenantA.workspace.id}/members`)
        .set('Authorization', `Bearer ${tenantA.token}`)
        .send({ email: 'charlie@collab.com', role: 'member' });

      // Try adding again
      const res2 = await request(app)
        .post(`/api/workspaces/${tenantA.workspace.id}/members`)
        .set('Authorization', `Bearer ${tenantA.token}`)
        .send({ email: 'charlie@collab.com', role: 'member' });

      assert.strictEqual(res2.status, 409);
      assert.strictEqual(res2.body.error, 'MEMBER_ALREADY_EXISTS');
    });

    it('enforces RBAC: viewer role cannot update workspace or add members', async () => {
      const tenantA = await registerUser('alice@tenant-a.com', 'Alice A', 'Tenant A Org');
      const userViewer = await registerUser('viewer@collab.com', 'Viewer V', 'Viewer Personal');
      const thirdUser = await registerUser('third@collab.com', 'Third T', 'Third Personal');

      // Add user as viewer
      await request(app)
        .post(`/api/workspaces/${tenantA.workspace.id}/members`)
        .set('Authorization', `Bearer ${tenantA.token}`)
        .send({ email: 'viewer@collab.com', role: 'viewer' });

      // Viewer attempts to update workspace name
      const updateRes = await request(app)
        .put(`/api/workspaces/${tenantA.workspace.id}`)
        .set('Authorization', `Bearer ${userViewer.token}`)
        .send({ name: 'Hacked by Viewer' });

      assert.strictEqual(updateRes.status, 403);
      assert.strictEqual(updateRes.body.error, 'INSUFFICIENT_PERMISSIONS');

      // Viewer attempts to invite another member
      const inviteRes = await request(app)
        .post(`/api/workspaces/${tenantA.workspace.id}/members`)
        .set('Authorization', `Bearer ${userViewer.token}`)
        .send({ email: 'third@collab.com', role: 'member' });

      assert.strictEqual(inviteRes.status, 403);
      assert.strictEqual(inviteRes.body.error, 'INSUFFICIENT_PERMISSIONS');
    });

    it('enforces RBAC: non-owner cannot delete workspace', async () => {
      const tenantA = await registerUser('alice@tenant-a.com', 'Alice A', 'Tenant A Org');
      const userAdmin = await registerUser('admin@collab.com', 'Admin A', 'Admin Personal');

      // Add admin
      await request(app)
        .post(`/api/workspaces/${tenantA.workspace.id}/members`)
        .set('Authorization', `Bearer ${tenantA.token}`)
        .send({ email: 'admin@collab.com', role: 'admin' });

      // Admin tries to delete workspace
      const delRes = await request(app)
        .delete(`/api/workspaces/${tenantA.workspace.id}`)
        .set('Authorization', `Bearer ${userAdmin.token}`);

      assert.strictEqual(delRes.status, 403);
      assert.strictEqual(delRes.body.error, 'INSUFFICIENT_PERMISSIONS');
    });

    it('allows owner to update member role and remove member', async () => {
      const tenantA = await registerUser('alice@tenant-a.com', 'Alice A', 'Tenant A Org');
      const userCharlie = await registerUser('charlie@collab.com', 'Charlie C', 'Charlie Personal');

      // Add Charlie as member
      await request(app)
        .post(`/api/workspaces/${tenantA.workspace.id}/members`)
        .set('Authorization', `Bearer ${tenantA.token}`)
        .send({ email: 'charlie@collab.com', role: 'member' });

      // Update Charlie to admin
      const updateRoleRes = await request(app)
        .put(`/api/workspaces/${tenantA.workspace.id}/members/${userCharlie.user.id}`)
        .set('Authorization', `Bearer ${tenantA.token}`)
        .send({ role: 'admin' });

      assert.strictEqual(updateRoleRes.status, 200);
      assert.strictEqual(updateRoleRes.body.member.role, 'admin');

      // Remove Charlie
      const removeRes = await request(app)
        .delete(`/api/workspaces/${tenantA.workspace.id}/members/${userCharlie.user.id}`)
        .set('Authorization', `Bearer ${tenantA.token}`);

      assert.strictEqual(removeRes.status, 200);
      assert.strictEqual(removeRes.body.success, true);

      // Verify Charlie no longer has access
      const accessRes = await request(app)
        .get(`/api/workspaces/${tenantA.workspace.id}`)
        .set('Authorization', `Bearer ${userCharlie.token}`);

      assert.strictEqual(accessRes.status, 404);
    });

    it('prevents modifying or removing workspace owner', async () => {
      const tenantA = await registerUser('alice@tenant-a.com', 'Alice A', 'Tenant A Org');

      // Attempt to demote owner
      const demoteRes = await request(app)
        .put(`/api/workspaces/${tenantA.workspace.id}/members/${tenantA.user.id}`)
        .set('Authorization', `Bearer ${tenantA.token}`)
        .send({ role: 'member' });

      assert.strictEqual(demoteRes.status, 400);
      assert.strictEqual(demoteRes.body.error, 'CANNOT_DEMOTE_OWNER');

      // Attempt to delete owner
      const delRes = await request(app)
        .delete(`/api/workspaces/${tenantA.workspace.id}/members/${tenantA.user.id}`)
        .set('Authorization', `Bearer ${tenantA.token}`);

      assert.strictEqual(delRes.status, 400);
      assert.strictEqual(delRes.body.error, 'CANNOT_REMOVE_OWNER');
    });
  });
});
