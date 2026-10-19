import request from 'supertest';
import app from '../../src/app.js';

let userCounter = 0;

export function getClient() {
  return request(app);
}

export async function createTestUser(client = request(app), overrides = {}) {
  userCounter += 1;
  const payload = {
    email: `testuser_${Date.now()}_${userCounter}@example.com`,
    password: 'Password123!',
    fullName: `Test User ${userCounter}`,
    workspaceName: `Workspace ${userCounter}`,
    ...overrides,
  };

  const res = await client.post('/api/auth/register').send(payload);
  return {
    status: res.status,
    body: res.body,
    token: res.body.token,
    authHeader: `Bearer ${res.body.token}`,
    user: res.body.user,
    workspace: res.body.workspace,
    rawPayload: payload,
  };
}
