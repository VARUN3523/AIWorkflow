import crypto from 'node:crypto';

/**
 * Stripe test fixtures and HMAC signature helper for E2E testing
 */

export const STRIPE_TEST_WEBHOOK_SECRET = 'whsec_test_secret_for_automated_e2e_suite_2026';

/**
 * Generate a valid Stripe-Signature header using HMAC-SHA256
 * Format: t=<timestamp>,v1=<signature>
 */
export function createStripeSignature(payload, secret = STRIPE_TEST_WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const signedPayload = `${timestamp}.${payloadString}`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(signedPayload);
  const signature = hmac.digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

export function createCheckoutSessionCompletedEvent(workspaceId, planId = 'starter', customerId = 'cus_test_12345') {
  return {
    id: `evt_test_${crypto.randomUUID().slice(0, 8)}`,
    object: 'event',
    api_version: '2023-10-16',
    created: Math.floor(Date.now() / 1000),
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_test_${crypto.randomUUID().slice(0, 12)}`,
        object: 'checkout.session',
        client_reference_id: workspaceId,
        customer: customerId,
        subscription: `sub_test_${crypto.randomUUID().slice(0, 12)}`,
        metadata: {
          workspace_id: workspaceId,
          plan_id: planId
        },
        payment_status: 'paid',
        status: 'complete'
      }
    }
  };
}

export function createSubscriptionUpdatedEvent(workspaceId, planId = 'pro', status = 'active') {
  return {
    id: `evt_sub_${crypto.randomUUID().slice(0, 8)}`,
    object: 'event',
    api_version: '2023-10-16',
    created: Math.floor(Date.now() / 1000),
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: `sub_test_updated_${crypto.randomUUID().slice(0, 8)}`,
        object: 'subscription',
        metadata: {
          workspace_id: workspaceId,
          plan_id: planId
        },
        status: status,
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400
      }
    }
  };
}

export function createSubscriptionDeletedEvent(workspaceId) {
  return {
    id: `evt_del_${crypto.randomUUID().slice(0, 8)}`,
    object: 'event',
    api_version: '2023-10-16',
    created: Math.floor(Date.now() / 1000),
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: `sub_test_canceled_${crypto.randomUUID().slice(0, 8)}`,
        object: 'subscription',
        metadata: {
          workspace_id: workspaceId
        },
        status: 'canceled'
      }
    }
  };
}

export function createInvoicePaymentSucceededEvent(workspaceId) {
  return {
    id: `evt_inv_${crypto.randomUUID().slice(0, 8)}`,
    object: 'event',
    api_version: '2023-10-16',
    created: Math.floor(Date.now() / 1000),
    type: 'invoice.payment_succeeded',
    data: {
      object: {
        id: `in_test_${crypto.randomUUID().slice(0, 8)}`,
        object: 'invoice',
        subscription_details: {
          metadata: {
            workspace_id: workspaceId
          }
        },
        amount_paid: 2900,
        currency: 'usd',
        paid: true
      }
    }
  };
}
