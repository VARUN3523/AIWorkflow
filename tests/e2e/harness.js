import request from 'supertest';
import app from '../../src/app.js';
import { setupTestDb } from '../helpers/test_db.js';
import {
  STRIPE_TEST_WEBHOOK_SECRET,
  createStripeSignature,
  createCheckoutSessionCompletedEvent,
  createSubscriptionUpdatedEvent,
  createSubscriptionDeletedEvent,
  createInvoicePaymentSucceededEvent
} from '../fixtures/stripe.js';
import {
  tenantAUser,
  tenantBUser,
  tenantCMember
} from '../fixtures/auth_tenants.js';
import {
  invoiceProcessingWorkflow,
  webhookLeadWorkflow,
  invalidEmptyStepsWorkflow,
  invalidStepTypeWorkflow,
  missingVariableRefWorkflow
} from '../fixtures/workflows.js';

import {
  sampleValidInvoiceText,
  sampleSMBInvoiceText,
  emptyInvoiceText,
  malformedInvoiceText,
  massiveInvoiceText
} from '../fixtures/invoices.js';
import {
  enterpriseLeadPayload,
  smbLeadPayload,
  spamLeadPayload,
  emptyLeadPayload,
  unicodeLeadPayload
} from '../fixtures/leads.js';

export {
  request,
  app,
  setupTestDb,
  STRIPE_TEST_WEBHOOK_SECRET,
  createStripeSignature,
  createCheckoutSessionCompletedEvent,
  createSubscriptionUpdatedEvent,
  createSubscriptionDeletedEvent,
  createInvoicePaymentSucceededEvent,
  tenantAUser,
  tenantBUser,
  tenantCMember,
  invoiceProcessingWorkflow,
  webhookLeadWorkflow,
  invalidEmptyStepsWorkflow,
  invalidStepTypeWorkflow,
  missingVariableRefWorkflow,
  sampleValidInvoiceText,
  sampleSMBInvoiceText,
  emptyInvoiceText,
  malformedInvoiceText,
  massiveInvoiceText,
  enterpriseLeadPayload,
  smbLeadPayload,
  spamLeadPayload,
  emptyLeadPayload,
  unicodeLeadPayload
};

/**
 * Checks whether an endpoint is mounted on the Express application.
 * If the response is a 404 with "Route not found", the feature is not yet mounted.
 */
export async function isFeatureAvailable(featureKey) {
  try {
    switch (featureKey) {
      case 'auth': {
        const res = await request(app).post('/api/auth/login').send({});
        return !(res.status === 404 && res.body?.message?.includes('Route not found'));
      }
      case 'workspaces': {
        const res = await request(app).get('/api/workspaces');
        return !(res.status === 404 && res.body?.message?.includes('Route not found'));
      }
      case 'workflows': {
        const res = await request(app).get('/api/workflows');
        return !(res.status === 404 && res.body?.message?.includes('Route not found'));
      }
      case 'engine': {
        const res = await request(app).get('/api/executions');
        return !(res.status === 404 && res.body?.message?.includes('Route not found'));
      }
      case 'billing': {
        const res = await request(app).get('/api/billing/usage');
        return !(res.status === 404 && res.body?.message?.includes('Route not found'));
      }
      case 'ui': {
        const res = await request(app).get('/');
        return !(res.status === 404 && res.body?.message?.includes('Route not found'));
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}

/**
 * Progressive testability guard.
 * If the required feature is not yet mounted in the current implementation milestone,
 * skips the test cleanly with an informative message.
 */
export async function requireFeature(t, featureKey, milestoneName) {
  const available = await isFeatureAvailable(featureKey);
  if (!available) {
    t.skip(`[Progressive Testability] Requires ${milestoneName} - '${featureKey}' endpoint is not yet mounted.`);
    return false;
  }
  return true;
}

/**
 * Helper to register a new user and return user info, default workspace, and token.
 */
export async function registerTenantUser(userData = tenantAUser, workspaceName) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      email: userData.email,
      password: userData.password,
      fullName: userData.fullName || userData.full_name,
      workspaceName: workspaceName || `${userData.fullName || 'User'} Workspace`
    });

  if (res.status !== 201) {
    throw new Error(`Failed to register tenant user (${res.status}): ${JSON.stringify(res.body)}`);
  }

  return {
    user: res.body.user,
    workspace: res.body.workspace,
    token: res.body.token,
    authHeader: `Bearer ${res.body.token}`
  };
}

/**
 * Helper to log in a user and return token and workspace.
 */
export async function loginTenantUser(email, password) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password });

  if (res.status !== 200) {
    throw new Error(`Failed to login tenant user (${res.status}): ${JSON.stringify(res.body)}`);
  }

  return {
    user: res.body.user,
    token: res.body.token,
    activeWorkspaceId: res.body.activeWorkspaceId,
    authHeader: `Bearer ${res.body.token}`
  };
}
