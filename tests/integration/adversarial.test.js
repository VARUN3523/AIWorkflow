import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import app from '../../src/app.js';
import { setupTestDb } from '../helpers/test_db.js';
import { authenticate } from '../../src/auth/middleware.js';

describe('Milestone 1 Adversarial Challenge Suite (R2: Robustness, IDOR & Concurrency)', () => {
  let testDb;

  beforeEach(() => {
    testDb = setupTestDb();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  // Helper to register a test user
  async function registerUser(email, fullName = 'Test User', wsName = 'Test Workspace') {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email,
        password: 'Password123!',
        fullName,
        workspaceName: wsName,
      });
    return {
      status: res.status,
      body: res.body,
      token: res.body.token,
      user: res.body.user,
      workspace: res.body.workspace,
    };
  }

  /* ========================================================================
   * 1. CROSS-TENANT PARAMETER TAMPERING (IDOR) & HEADER SPOOFING
   * ======================================================================== */
  describe('1. Cross-Tenant IDOR and Header Spoofing Attacks', () => {
    it('ATTACK-1.1: Forged x-workspace-id header on GET /api/auth/me does not leak foreign tenant workspace', async () => {
      const tenantA = await registerUser('victim@tenant-a.com', 'Victim A', 'Victim Corp');
      const tenantB = await registerUser('attacker@tenant-b.com', 'Attacker B', 'Attacker Corp');

      // Tenant B passes Tenant A's workspace ID in x-workspace-id
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${tenantB.token}`)
        .set('x-workspace-id', tenantA.workspace.id);

      assert.strictEqual(res.status, 200);
      // Ensure returned activeWorkspace is NOT Tenant A's workspace
      assert.notStrictEqual(res.body.activeWorkspace?.id, tenantA.workspace.id);
      assert.strictEqual(res.body.activeWorkspace?.id, tenantB.workspace.id);
      // Ensure workspaces list contains ONLY Tenant B's workspaces
      const ids = res.body.workspaces.map((w) => w.id);
      assert.ok(!ids.includes(tenantA.workspace.id), 'Foreign workspace leaked in user workspaces list');
    });

    it('ATTACK-1.2: Manipulated workspace IDs (SQL injection, path traversal, non-existent) return 404 JSON', async () => {
      const tenantA = await registerUser('user@corp.com', 'User Corp', 'Corp Org');

      const hostileIds = [
        "ws_non_existent_1234567890",
        "../../etc/passwd",
        "' OR '1'='1",
        "null",
        "undefined",
        "<script>alert(1)</script>",
        "ws_'; DROP TABLE workspaces; --",
      ];

      for (const hostileId of hostileIds) {
        const res = await request(app)
          .get(`/api/workspaces/${encodeURIComponent(hostileId)}`)
          .set('Authorization', `Bearer ${tenantA.token}`);

        assert.strictEqual(res.status, 404, `Expected 404 for ID: ${hostileId}`);
        assert.strictEqual(typeof res.body, 'object');
        assert.strictEqual(res.body.error, 'WORKSPACE_NOT_FOUND');
      }
    });

    it('ATTACK-1.3: Foreign tenant attempts to switch active workspace to another tenant (POST /switch)', async () => {
      const tenantA = await registerUser('alice@tenant-a.com', 'Alice A', 'Org A');
      const tenantB = await registerUser('bob@tenant-b.com', 'Bob B', 'Org B');

      const res = await request(app)
        .post(`/api/workspaces/${tenantA.workspace.id}/switch`)
        .set('Authorization', `Bearer ${tenantB.token}`);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, 'FORBIDDEN');
    });

    it('ATTACK-1.4: Cross-tenant member management tampering is strictly rejected with 404', async () => {
      const tenantA = await registerUser('alice@tenant-a.com', 'Alice A', 'Org A');
      const tenantB = await registerUser('bob@tenant-b.com', 'Bob B', 'Org B');
      const outsider = await registerUser('outsider@saas.com', 'Outsider', 'Outsider Org');

      // 1. Tenant B tries to list Tenant A's members
      const listRes = await request(app)
        .get(`/api/workspaces/${tenantA.workspace.id}/members`)
        .set('Authorization', `Bearer ${tenantB.token}`);
      assert.strictEqual(listRes.status, 404);
      assert.strictEqual(listRes.body.error, 'WORKSPACE_NOT_FOUND');

      // 2. Tenant B tries to add a member to Tenant A's workspace
      const addRes = await request(app)
        .post(`/api/workspaces/${tenantA.workspace.id}/members`)
        .set('Authorization', `Bearer ${tenantB.token}`)
        .send({ email: outsider.user.email, role: 'member' });
      assert.strictEqual(addRes.status, 404);
      assert.strictEqual(addRes.body.error, 'WORKSPACE_NOT_FOUND');

      // 3. Tenant B tries to change Tenant A owner role
      const updateRoleRes = await request(app)
        .put(`/api/workspaces/${tenantA.workspace.id}/members/${tenantA.user.id}`)
        .set('Authorization', `Bearer ${tenantB.token}`)
        .send({ role: 'viewer' });
      assert.strictEqual(updateRoleRes.status, 404);
      assert.strictEqual(updateRoleRes.body.error, 'WORKSPACE_NOT_FOUND');

      // 4. Tenant B tries to remove Tenant A owner
      const removeRes = await request(app)
        .delete(`/api/workspaces/${tenantA.workspace.id}/members/${tenantA.user.id}`)
        .set('Authorization', `Bearer ${tenantB.token}`);
      assert.strictEqual(removeRes.status, 404);
      assert.strictEqual(removeRes.body.error, 'WORKSPACE_NOT_FOUND');
    });

    it('ATTACK-1.5: Authenticate middleware strictly blocks foreign x-workspace-id header with 403', async () => {
      const tenantA = await registerUser('alice@tenant-a.com', 'Alice A', 'Org A');
      const tenantB = await registerUser('bob@tenant-b.com', 'Bob B', 'Org B');

      // Create an express instance to isolate testing of the authenticate middleware
      const testServer = express();
      testServer.get('/test/protected-route', authenticate, (req, res) => {
        res.status(200).json({ ok: true, workspaceId: req.workspaceId, role: req.memberRole });
      });

      // Tenant B tries to access route with Tenant A's workspace in header -> 403 FORBIDDEN
      const resHostile = await request(testServer)
        .get('/test/protected-route')
        .set('Authorization', `Bearer ${tenantB.token}`)
        .set('x-workspace-id', tenantA.workspace.id);

      assert.strictEqual(resHostile.status, 403);
      assert.strictEqual(resHostile.body.error, 'FORBIDDEN');
      assert.strictEqual(resHostile.body.message, 'You do not have access to this workspace');

      // Tenant B accesses route with own workspace -> 200 OK
      const resValid = await request(testServer)
        .get('/test/protected-route')
        .set('Authorization', `Bearer ${tenantB.token}`)
        .set('x-workspace-id', tenantB.workspace.id);

      assert.strictEqual(resValid.status, 200);
      assert.strictEqual(resValid.body.workspaceId, tenantB.workspace.id);
      assert.strictEqual(resValid.body.role, 'owner');
    });
  });

  /* ========================================================================
   * 2. CREDENTIAL ATTACKS & MALICIOUS INPUT TAMPERING
   * ======================================================================== */
  describe('2. Credential Attacks and Malicious Input Tampering', () => {
    it('ATTACK-2.1: Rejects empty or whitespace-only passwords during registration', async () => {
      const emptyRes = await request(app)
        .post('/api/auth/register')
        .send({ email: 'user1@test.com', password: '', fullName: 'User 1' });
      assert.strictEqual(emptyRes.status, 400);
      assert.strictEqual(emptyRes.body.error, 'WEAK_PASSWORD');

      const spaceRes = await request(app)
        .post('/api/auth/register')
        .send({ email: 'user2@test.com', password: '       ', fullName: 'User 2' });
      assert.strictEqual(spaceRes.status, 400);
      assert.strictEqual(spaceRes.body.error, 'WEAK_PASSWORD');
    });

    it('ATTACK-2.2: Rejects extreme length inputs (> 1024 chars) to prevent scrypt CPU exhaustion DoS', async () => {
      const hugePassword = 'A'.repeat(5000);
      const start = Date.now();
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'dos@test.com', password: hugePassword, fullName: 'DoS Attacker' });
      const elapsed = Date.now() - start;

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'PASSWORD_TOO_LONG');
      // Should reject immediately without burning CPU in scrypt
      assert.ok(elapsed < 200, `Execution took too long (${elapsed}ms), possible DoS vulnerability`);
    });

    it('ATTACK-2.3: Login with huge password (> 1024 chars) is immediately rejected without CPU hang', async () => {
      const hugePassword = 'B'.repeat(10000);
      const start = Date.now();
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'user@test.com', password: hugePassword });
      const elapsed = Date.now() - start;

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, 'INVALID_CREDENTIALS');
      assert.ok(elapsed < 200, `Login DoS check took too long (${elapsed}ms)`);
    });

    it('ATTACK-2.4: SQL injection in email during registration does not execute or bypass checks', async () => {
      const sqliEmails = [
        "' OR '1'='1'@evil.com",
        "admin'--@test.com",
        "test'; DROP TABLE users; --@test.com",
      ];

      for (const email of sqliEmails) {
        const res = await request(app)
          .post('/api/auth/register')
          .send({ email, password: 'ValidPassword123!', fullName: 'SQLi Tester' });

        // Either accepted as literal string or rejected if email format rules fail
        // Crucially, tables must NOT be dropped and no SQL syntax error thrown
        assert.ok([201, 400, 409].includes(res.status));
        assert.strictEqual(typeof res.body, 'object');
      }

      // Verify users and workspaces tables are intact
      const tableCheck = testDb.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'workspaces')")
        .all();
      assert.strictEqual(tableCheck.length, 2, 'Tables were damaged by SQL injection attempt');
    });

    it('ATTACK-2.5: SQL injection in login credentials does not bypass authentication', async () => {
      await registerUser('admin@saas.com', 'Admin User', 'Admin Org');

      const hostileAttempts = [
        { email: "' OR '1'='1' --", password: 'any' },
        { email: "admin@saas.com' --", password: 'any' },
        { email: "admin@saas.com", password: "' OR '1'='1" },
        { email: "' OR 1=1; --", password: "Password123!" },
      ];

      for (const attempt of hostileAttempts) {
        const res = await request(app)
          .post('/api/auth/login')
          .send(attempt);

        assert.strictEqual(res.status, 401, `SQLi login succeeded or crashed for: ${JSON.stringify(attempt)}`);
        assert.strictEqual(res.body.error, 'INVALID_CREDENTIALS');
      }
    });

    it('ATTACK-2.6: SQL injection in fullName and workspaceName stored safely as literal strings', async () => {
      const sqliPayload = "'; DROP TABLE subscriptions; -- <script>alert('xss')</script>";
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'xss_sqli@test.com',
          password: 'Password123!',
          fullName: sqliPayload,
          workspaceName: sqliPayload,
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.user.fullName, sqliPayload);
      assert.strictEqual(res.body.workspace.name, sqliPayload);

      // Verify subscriptions table is completely intact
      const sub = testDb.db
        .prepare('SELECT * FROM subscriptions WHERE workspace_id = ?')
        .get(res.body.workspace.id);
      assert.ok(sub, 'Subscription record missing, possible SQL injection damage');
    });

    it('ATTACK-2.7: Null byte handling in inputs is safely processed without unhandled crash', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'nullbyte\0@example.com',
          password: 'Password123!\0test',
          fullName: 'Null\0Byte',
          workspaceName: 'Null\0Workspace',
        });

      // Should complete without uncaught exception or crash
      assert.ok([201, 400].includes(res.status));
      assert.strictEqual(typeof res.body, 'object');
    });

    it('ATTACK-2.8: Invalid or forged session tokens in Authorization or x-session-token headers', async () => {
      const forgedTokens = [
        'invalid_token_123',
        '0000000000000000000000000000000000000000000000000000000000000000',
        "' OR '1'='1",
        'null',
      ];

      for (const token of forgedTokens) {
        // Test Bearer
        const res1 = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${token}`);
        assert.strictEqual(res1.status, 401);
        assert.strictEqual(res1.body.error, 'UNAUTHORIZED');

        // Test x-session-token
        const res2 = await request(app)
          .get('/api/auth/me')
          .set('x-session-token', token);
        assert.strictEqual(res2.status, 401);
        assert.strictEqual(res2.body.error, 'UNAUTHORIZED');
      }
    });

    it('ATTACK-2.9: Expired session token is rejected with 401 and cleaned up', async () => {
      const user = await registerUser('expiry@test.com');

      // Artificially expire the token in database
      const pastDate = new Date(Date.now() - 100000).toISOString();
      testDb.db
        .prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
        .run(pastDate, user.token);

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${user.token}`);

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, 'UNAUTHORIZED');

      // Verify the expired session is deleted
      const sessionRow = testDb.db
        .prepare('SELECT * FROM sessions WHERE id = ?')
        .get(user.token);
      assert.strictEqual(sessionRow, undefined, 'Expired session was not deleted');
    });
  });

  /* ========================================================================
   * 3. RBAC PRIVILEGE ESCALATION & INVARIANTS DEFENSE
   * ======================================================================== */
  describe('3. RBAC Privilege Escalation & Invariants Defense', () => {
    it('ATTACK-3.1: Viewer cannot mutate workspace, invite members, or delete workspace', async () => {
      const owner = await registerUser('owner@company.com', 'Owner', 'Company');
      const viewer = await registerUser('viewer@company.com', 'Viewer', 'Viewer WS');

      // Owner adds viewer to Company workspace
      await request(app)
        .post(`/api/workspaces/${owner.workspace.id}/members`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ email: viewer.user.email, role: 'viewer' });

      // 1. Viewer attempts to rename workspace
      const renameRes = await request(app)
        .put(`/api/workspaces/${owner.workspace.id}`)
        .set('Authorization', `Bearer ${viewer.token}`)
        .send({ name: 'Hacked by Viewer' });
      assert.strictEqual(renameRes.status, 403);
      assert.strictEqual(renameRes.body.error, 'INSUFFICIENT_PERMISSIONS');

      // 2. Viewer attempts to invite another member
      const inviteRes = await request(app)
        .post(`/api/workspaces/${owner.workspace.id}/members`)
        .set('Authorization', `Bearer ${viewer.token}`)
        .send({ email: 'someone@company.com', role: 'member' });
      assert.strictEqual(inviteRes.status, 403);
      assert.strictEqual(inviteRes.body.error, 'INSUFFICIENT_PERMISSIONS');

      // 3. Viewer attempts to delete workspace
      const deleteRes = await request(app)
        .delete(`/api/workspaces/${owner.workspace.id}`)
        .set('Authorization', `Bearer ${viewer.token}`);
      assert.strictEqual(deleteRes.status, 403);
      assert.strictEqual(deleteRes.body.error, 'INSUFFICIENT_PERMISSIONS');
    });

    it('ATTACK-3.2: Member cannot self-promote to admin or owner', async () => {
      const owner = await registerUser('owner@corp.com', 'Owner', 'Corp');
      const member = await registerUser('member@corp.com', 'Member', 'Member WS');

      await request(app)
        .post(`/api/workspaces/${owner.workspace.id}/members`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ email: member.user.email, role: 'member' });

      // Member attempts to promote themselves to admin
      const promoteRes = await request(app)
        .put(`/api/workspaces/${owner.workspace.id}/members/${member.user.id}`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({ role: 'admin' });

      assert.strictEqual(promoteRes.status, 403);
      assert.strictEqual(promoteRes.body.error, 'INSUFFICIENT_PERMISSIONS');
    });

    it('ATTACK-3.3: Cannot invite member with role owner (only admin, member, viewer allowed)', async () => {
      const owner = await registerUser('owner@corp.com', 'Owner', 'Corp');
      const target = await registerUser('target@corp.com', 'Target', 'Target WS');

      const res = await request(app)
        .post(`/api/workspaces/${owner.workspace.id}/members`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ email: target.user.email, role: 'owner' });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'INVALID_ROLE');
    });

    it('ATTACK-3.4: Admin cannot demote or remove the workspace owner', async () => {
      const owner = await registerUser('owner@corp.com', 'Owner', 'Corp');
      const admin = await registerUser('admin@corp.com', 'Admin', 'Admin WS');

      await request(app)
        .post(`/api/workspaces/${owner.workspace.id}/members`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ email: admin.user.email, role: 'admin' });

      // Admin tries to demote owner
      const demoteRes = await request(app)
        .put(`/api/workspaces/${owner.workspace.id}/members/${owner.user.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ role: 'member' });
      assert.strictEqual(demoteRes.status, 400);
      assert.strictEqual(demoteRes.body.error, 'CANNOT_DEMOTE_OWNER');

      // Admin tries to remove owner
      const removeRes = await request(app)
        .delete(`/api/workspaces/${owner.workspace.id}/members/${owner.user.id}`)
        .set('Authorization', `Bearer ${admin.token}`);
      assert.strictEqual(removeRes.status, 400);
      assert.strictEqual(removeRes.body.error, 'CANNOT_REMOVE_OWNER');
    });

    it('ATTACK-3.5: Admin cannot demote or remove another admin', async () => {
      const owner = await registerUser('owner@corp.com', 'Owner', 'Corp');
      const admin1 = await registerUser('admin1@corp.com', 'Admin 1', 'Admin 1 WS');
      const admin2 = await registerUser('admin2@corp.com', 'Admin 2', 'Admin 2 WS');

      await request(app)
        .post(`/api/workspaces/${owner.workspace.id}/members`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ email: admin1.user.email, role: 'admin' });

      await request(app)
        .post(`/api/workspaces/${owner.workspace.id}/members`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ email: admin2.user.email, role: 'admin' });

      // Admin 1 attempts to demote Admin 2
      const demoteRes = await request(app)
        .put(`/api/workspaces/${owner.workspace.id}/members/${admin2.user.id}`)
        .set('Authorization', `Bearer ${admin1.token}`)
        .send({ role: 'member' });
      assert.strictEqual(demoteRes.status, 403);
      assert.strictEqual(demoteRes.body.error, 'INSUFFICIENT_PERMISSIONS');

      // Admin 1 attempts to remove Admin 2
      const removeRes = await request(app)
        .delete(`/api/workspaces/${owner.workspace.id}/members/${admin2.user.id}`)
        .set('Authorization', `Bearer ${admin1.token}`);
      assert.strictEqual(removeRes.status, 403);
      assert.strictEqual(removeRes.body.error, 'INSUFFICIENT_PERMISSIONS');
    });

    it('ATTACK-3.6: Owner cannot self-remove to orphan a workspace', async () => {
      const owner = await registerUser('owner@corp.com', 'Owner', 'Corp');

      const res = await request(app)
        .delete(`/api/workspaces/${owner.workspace.id}/members/${owner.user.id}`)
        .set('Authorization', `Bearer ${owner.token}`);

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'CANNOT_REMOVE_OWNER');
    });
  });

  /* ========================================================================
   * 4. CONCURRENCY & RACE CONDITIONS
   * ======================================================================== */
  describe('4. Concurrency and Race Condition Stress Tests', () => {
    it('STRESS-4.1: Rapid concurrent duplicate registrations with identical email', async () => {
      const targetEmail = 'concurrent_reg@test.com';
      const requests = Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post('/api/auth/register')
          .send({
            email: targetEmail,
            password: 'Password123!',
            fullName: `User ${i}`,
          })
      );

      const results = await Promise.all(requests);
      const successes = results.filter((r) => r.status === 201);
      const failures = results.filter((r) => r.status === 409 || r.status === 500);

      assert.strictEqual(successes.length, 1, 'Exactly one registration should succeed');
      assert.strictEqual(failures.length, 4, 'All subsequent registrations should fail');

      // Verify database integrity: exactly one user record exists
      const users = testDb.db
        .prepare('SELECT id, email FROM users WHERE email = ?')
        .all(targetEmail);
      assert.strictEqual(users.length, 1);
    });

    it('STRESS-4.2: Rapid concurrent duplicate member additions to the same workspace', async () => {
      const owner = await registerUser('owner@concurrency.com', 'Owner', 'Concurrency Org');
      const target = await registerUser('invitee@concurrency.com', 'Invitee', 'Invitee Org');

      const requests = Array.from({ length: 5 }, () =>
        request(app)
          .post(`/api/workspaces/${owner.workspace.id}/members`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ email: target.user.email, role: 'member' })
      );

      const results = await Promise.all(requests);
      const successes = results.filter((r) => r.status === 201);
      const rejections = results.filter((r) => r.status === 409 || r.status === 500);

      assert.strictEqual(successes.length, 1, 'Only one member addition should succeed');
      assert.strictEqual(rejections.length, 4, 'All duplicate additions should be rejected');

      // Verify database integrity: exactly one membership record exists
      const memberships = testDb.db
        .prepare('SELECT id FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
        .all(owner.workspace.id, target.user.id);
      assert.strictEqual(memberships.length, 1);
    });

    it('STRESS-4.3: Rapid concurrent workspace creations by same user creates distinct valid workspaces', async () => {
      const user = await registerUser('creator@concurrency.com', 'Creator', 'Creator Base');

      const requests = Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post('/api/workspaces')
          .set('Authorization', `Bearer ${user.token}`)
          .send({ name: `Parallel Workspace ${i}` })
      );

      const results = await Promise.all(requests);
      for (const res of results) {
        assert.strictEqual(res.status, 201);
        assert.ok(res.body.workspace.id);
        assert.ok(res.body.workspace.slug);
      }

      // Check user now has 1 base + 5 created = 6 workspaces
      const listRes = await request(app)
        .get('/api/workspaces')
        .set('Authorization', `Bearer ${user.token}`);
      assert.strictEqual(listRes.status, 200);
      assert.strictEqual(listRes.body.workspaces.length, 6);
    });
  });

  /* ========================================================================
   * 5. PROTOCOL & PAYLOAD HYGIENE
   * ======================================================================== */
  describe('5. Protocol and Payload Hygiene', () => {
    it('HYGIENE-5.1: Malformed JSON request body returns clean 400 JSON error without crash', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .set('Content-Type', 'application/json')
        .send('{"email": "broken_json", ');

      assert.strictEqual(res.status, 400);
      assert.strictEqual(typeof res.body, 'object');
      assert.ok(res.body.error);
    });

    it('HYGIENE-5.2: Unexpected types in register body (numbers, booleans, arrays) return clean JSON error', async () => {
      const hostileTypes = [
        { email: 12345, password: 'Password123!', fullName: 'Test' },
        { email: ['array@example.com'], password: 'Password123!', fullName: 'Test' },
        { email: 'valid@example.com', password: 12345678, fullName: 'Test' },
        { email: 'valid2@example.com', password: 'Password123!', fullName: { first: 'Test' } },
        { email: 'valid3@example.com', password: 'Password123!', fullName: 'Test', workspaceName: 12345 },
      ];

      for (const payload of hostileTypes) {
        const res = await request(app)
          .post('/api/auth/register')
          .send(payload);

        assert.ok([400, 500].includes(res.status));
        assert.strictEqual(typeof res.body, 'object');
        assert.ok(res.body.error);
        assert.ok(res.body.message);
      }
    });

    it('HYGIENE-5.3: Unknown routes consistently return clean JSON error without crashing', async () => {
      const tenant = await registerUser('tester@hygiene.com');

      // Public unknown routes return 404
      const publicRoutes = ['/api/unknown', '/api/auth/nonexistent', '/random/path'];
      for (const path of publicRoutes) {
        const res = await request(app).get(path);
        assert.strictEqual(res.status, 404);
        assert.strictEqual(res.body.error, 'NOT_FOUND');
        assert.ok(res.body.message.includes('Route not found'));
      }

      // Authenticated call to unknown route under /api/workspaces returns 404
      const authRes = await request(app)
        .get('/api/workspaces/ws_any/nonexistent_subroute')
        .set('Authorization', `Bearer ${tenant.token}`);
      assert.strictEqual(authRes.status, 404);
      assert.strictEqual(authRes.body.error, 'NOT_FOUND');

      // Unauthenticated call to protected workspace route returns 401
      const unauthRes = await request(app).get('/api/workspaces/ws_any/nonexistent_subroute');
      assert.strictEqual(unauthRes.status, 401);
      assert.strictEqual(unauthRes.body.error, 'UNAUTHORIZED');
    });

    it('HYGIENE-5.4: Malformed Authorization headers (empty, basic, truncated) return 401', async () => {
      const malformedHeaders = [
        '',
        'Bearer',
        'Bearer ',
        'Basic dXNlcjpwYXNz',
        'Token 12345',
        'bearer',
        'Bearer token-with-spaces extra',
      ];

      for (const header of malformedHeaders) {
        const res = await request(app)
          .get('/api/auth/me')
          .set('Authorization', header);
        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.error, 'UNAUTHORIZED');
      }
    });
  });

  /* ========================================================================
   * 6. DATA INTEGRITY, CASCADES & HIGH-LOAD CONCURRENCY
   * ======================================================================== */
  describe('6. Data Integrity, Cascades & High-Load Concurrency', () => {
    it('INTEGRITY-6.1: Cascade deletion of workspace cleanly removes dependent records', async () => {
      const owner = await registerUser('cascade_owner@saas.com', 'Cascade Owner', 'Cascade Corp');
      const wsId = owner.workspace.id;

      // Verify initial dependent records exist
      const subBefore = testDb.db.prepare('SELECT id FROM subscriptions WHERE workspace_id = ?').get(wsId);
      const meterBefore = testDb.db.prepare('SELECT id FROM usage_meters WHERE workspace_id = ?').get(wsId);
      const membersBefore = testDb.db.prepare('SELECT id FROM workspace_members WHERE workspace_id = ?').all(wsId);
      assert.ok(subBefore);
      assert.ok(meterBefore);
      assert.strictEqual(membersBefore.length, 1);

      // Owner deletes workspace
      const delRes = await request(app)
        .delete(`/api/workspaces/${wsId}`)
        .set('Authorization', `Bearer ${owner.token}`);
      assert.strictEqual(delRes.status, 200);

      // Verify cascade deletion cleaned up all associated records without FK errors
      const subAfter = testDb.db.prepare('SELECT id FROM subscriptions WHERE workspace_id = ?').get(wsId);
      const meterAfter = testDb.db.prepare('SELECT id FROM usage_meters WHERE workspace_id = ?').get(wsId);
      const membersAfter = testDb.db.prepare('SELECT id FROM workspace_members WHERE workspace_id = ?').all(wsId);
      const wsAfter = testDb.db.prepare('SELECT id FROM workspaces WHERE id = ?').get(wsId);

      assert.strictEqual(wsAfter, undefined);
      assert.strictEqual(subAfter, undefined);
      assert.strictEqual(meterAfter, undefined);
      assert.strictEqual(membersAfter.length, 0);
    });

    it('INTEGRITY-6.2: Unicode, emojis, RTL marks, and international characters are preserved safely', async () => {
      const complexName = '🚀 AI 自動化 Platform 日本語 עִבְרִית';
      const user = await registerUser('unicode@saas.com', complexName, complexName);

      assert.strictEqual(user.status, 201);
      assert.strictEqual(user.body.user.fullName, complexName);
      assert.strictEqual(user.body.workspace.name, complexName);

      // Query database directly to confirm uncorrupted utf-8 persistence
      const row = testDb.db.prepare('SELECT name FROM workspaces WHERE id = ?').get(user.workspace.id);
      assert.strictEqual(row.name, complexName);
    });

    it('STRESS-6.3: High-load parallel workspace requests (20 simultaneous requests) execute without WAL deadlock', async () => {
      const user = await registerUser('highload@saas.com', 'Load Tester', 'Load WS');

      // Create 5 additional workspaces first
      const createdIds = [];
      for (let i = 0; i < 5; i++) {
        const createRes = await request(app)
          .post('/api/workspaces')
          .set('Authorization', `Bearer ${user.token}`)
          .send({ name: `Batch WS ${i}` });
        createdIds.push(createRes.body.workspace.id);
      }

      // Fire 20 parallel mixed read/write operations
      const operations = Array.from({ length: 20 }, (_, idx) => {
        const targetWsId = createdIds[idx % createdIds.length];
        if (idx % 2 === 0) {
          // Read
          return request(app)
            .get(`/api/workspaces/${targetWsId}`)
            .set('Authorization', `Bearer ${user.token}`);
        } else {
          // Update
          return request(app)
            .put(`/api/workspaces/${targetWsId}`)
            .set('Authorization', `Bearer ${user.token}`)
            .send({ name: `Updated WS ${idx}` });
        }
      });

      const results = await Promise.all(operations);
      for (const res of results) {
        assert.strictEqual(res.status, 200, `Request failed under high concurrency: ${res.text}`);
        assert.ok(res.body.workspace);
      }
    });
  });
});
