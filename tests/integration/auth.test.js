import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../src/app.js';
import { setupTestDb } from '../helpers/test_db.js';

describe('Auth Integration Tests (R2: Authentication & Sessions)', () => {
  let testDb;

  beforeEach(() => {
    testDb = setupTestDb();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe('POST /api/auth/register', () => {
    it('successfully registers a user with an auto-created workspace and free subscription', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'founder@saas.com',
          password: 'SuperSecurePassword123!',
          fullName: 'Alice Founder',
          workspaceName: 'Acme SaaS Corp',
        });

      assert.strictEqual(res.status, 201);
      assert.ok(res.body.token);
      assert.strictEqual(typeof res.body.token, 'string');

      // Verify user
      assert.ok(res.body.user);
      assert.strictEqual(res.body.user.email, 'founder@saas.com');
      assert.strictEqual(res.body.user.fullName, 'Alice Founder');
      assert.ok(res.body.user.id.startsWith('usr_'));

      // Verify workspace
      assert.ok(res.body.workspace);
      assert.strictEqual(res.body.workspace.name, 'Acme SaaS Corp');
      assert.strictEqual(res.body.workspace.role, 'owner');
      assert.ok(res.body.workspace.id.startsWith('ws_'));

      // Verify database persistence: subscription and usage meter
      const sub = testDb.db
        .prepare('SELECT * FROM subscriptions WHERE workspace_id = ?')
        .get(res.body.workspace.id);
      assert.ok(sub);
      assert.strictEqual(sub.plan_id, 'free');
      assert.strictEqual(sub.status, 'active');

      const meter = testDb.db
        .prepare('SELECT * FROM usage_meters WHERE workspace_id = ?')
        .get(res.body.workspace.id);
      assert.ok(meter);
      assert.strictEqual(meter.runs_count, 0);
    });

    it('creates default workspace name if workspaceName is omitted', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'bob@saas.com',
          password: 'SuperSecurePassword123!',
          fullName: 'Bob Builder',
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.workspace.name, "Bob Builder's Workspace");
    });

    it('rejects duplicate email with 409 Conflict (case-insensitive)', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'alice@domain.com',
          password: 'Password123!',
          fullName: 'Alice',
        });

      // Try duplicate in uppercase
      const res2 = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'ALICE@DOMAIN.COM',
          password: 'Password456!',
          fullName: 'Alice Copy',
        });

      assert.strictEqual(res2.status, 409);
      assert.strictEqual(res2.body.error, 'EMAIL_ALREADY_EXISTS');
    });

    it('validates invalid or missing email with 400 Bad Request', async () => {
      const res1 = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'not-an-email',
          password: 'Password123!',
          fullName: 'Alice',
        });
      assert.strictEqual(res1.status, 400);

      const res2 = await request(app)
        .post('/api/auth/register')
        .send({
          password: 'Password123!',
          fullName: 'Alice',
        });
      assert.strictEqual(res2.status, 400);
    });

    it('validates short password (< 8 chars) with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'short',
          fullName: 'Alice',
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'WEAK_PASSWORD');
    });

    it('rejects excessively long password (> 1024 chars) to prevent DoS', async () => {
      const longPassword = 'a'.repeat(1025);
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: longPassword,
          fullName: 'Alice',
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'PASSWORD_TOO_LONG');
    });

    it('validates missing full name with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'Password123!',
          fullName: '   ',
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'INVALID_NAME');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'carol@enterprise.com',
          password: 'CarolPassword123!',
          fullName: 'Carol Danvers',
        });
    });

    it('successfully logs in with valid credentials and returns active workspace', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'carol@enterprise.com',
          password: 'CarolPassword123!',
        });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.token);
      assert.strictEqual(res.body.user.email, 'carol@enterprise.com');
      assert.ok(res.body.activeWorkspaceId.startsWith('ws_'));
    });

    it('supports case-insensitive email login', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'CAROL@ENTERPRISE.COM',
          password: 'CarolPassword123!',
        });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.token);
    });

    it('rejects invalid password with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'carol@enterprise.com',
          password: 'WrongPassword!',
        });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, 'INVALID_CREDENTIALS');
    });

    it('rejects non-existent email with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nobody@nowhere.com',
          password: 'CarolPassword123!',
        });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, 'INVALID_CREDENTIALS');
    });

    it('rejects missing credentials with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({});

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'MISSING_CREDENTIALS');
    });
  });

  describe('GET /api/auth/me', () => {
    let token;

    beforeEach(async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'dave@co.com',
          password: 'DavePassword123!',
          fullName: 'Dave Bowman',
        });
      token = reg.body.token;
    });

    it('returns current user profile and workspaces with valid Bearer token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.user.email, 'dave@co.com');
      assert.strictEqual(res.body.user.fullName, 'Dave Bowman');
      assert.ok(Array.isArray(res.body.workspaces));
      assert.strictEqual(res.body.workspaces.length, 1);
      assert.strictEqual(res.body.workspaces[0].role, 'owner');
      assert.ok(res.body.activeWorkspace);
      assert.strictEqual(res.body.activeWorkspace.role, 'owner');
    });

    it('supports authentication via x-session-token header', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('x-session-token', token);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.user.email, 'dave@co.com');
    });

    it('rejects request without token with 401 Unauthorized', async () => {
      const res = await request(app).get('/api/auth/me');
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, 'UNAUTHORIZED');
    });

    it('rejects request with forged/invalid token with 401 Unauthorized', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid_forged_token');

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, 'UNAUTHORIZED');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('invalidates active session token', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'eve@co.com',
          password: 'EvePassword123!',
          fullName: 'Eve Polastri',
        });
      const token = reg.body.token;

      // Verify token works before logout
      const beforeRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(beforeRes.status, 200);

      // Perform logout
      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(logoutRes.status, 200);
      assert.strictEqual(logoutRes.body.success, true);

      // Verify token is now rejected
      const afterRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(afterRes.status, 401);
      assert.strictEqual(afterRes.body.error, 'UNAUTHORIZED');
    });
  });

  describe('GET /health & 404 Handler', () => {
    it('returns 200 OK with health status and timestamp', async () => {
      const res = await request(app).get('/health');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'ok');
      assert.ok(res.body.timestamp);
    });

    it('returns 404 with JSON error for unknown routes', async () => {
      const res = await request(app).get('/api/unknown/endpoint');
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'NOT_FOUND');
    });
  });
});

