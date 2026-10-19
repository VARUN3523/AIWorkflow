import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { getCurrentBillingPeriod } from '../auth/service.js';

/**
 * Plan Tier Definitions (F-BILL-01)
 * Free/Trial: 50 runs/mo, 3 workflows ($0)
 * Starter: 1,000 runs/mo, 25 workflows ($29/mo)
 * Pro: 10,000 runs/mo, unlimited workflows ($99/mo)
 */
export const TIERS = {
  free: {
    id: 'free',
    name: 'Free / Trial',
    price_monthly: 0,
    priceMonthlyUsd: 0,
    monthly_runs: 50,
    monthlyRuns: 50,
    max_workflows: 3,
    maxWorkflows: 3,
    features: [
      '50 workflow runs/month',
      'Up to 3 active workflows',
      'Manual trigger',
      'Document extraction',
      'Text classification'
    ]
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    price_monthly: 29,
    priceMonthlyUsd: 29,
    monthly_runs: 1000,
    monthlyRuns: 1000,
    max_workflows: 25,
    maxWorkflows: 25,
    features: [
      '1,000 workflow runs/month',
      'Up to 25 active workflows',
      'Webhook triggers',
      'File upload triggers',
      'Executive synthesis',
      'Email support'
    ]
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price_monthly: 99,
    priceMonthlyUsd: 99,
    monthly_runs: 10000,
    monthlyRuns: 10000,
    max_workflows: Infinity,
    maxWorkflows: Infinity,
    features: [
      '10,000 workflow runs/month',
      'Unlimited active workflows',
      'High-concurrency pipeline execution',
      'Custom schemas & models',
      'Multi-member workspace collaboration',
      'Priority support'
    ]
  }
};

export const PLAN_LIMITS = {
  free: 50,
  starter: 1000,
  pro: 10000
};

/**
 * Retrieve tier definition by plan ID (defaults to 'free')
 */
export function getTier(planId) {
  const normalized = (planId || '').toLowerCase().trim();
  return TIERS[normalized] || TIERS.free;
}

/**
 * Get all available subscription tiers
 */
export function getAllTiers() {
  return Object.values(TIERS);
}

/**
 * Fetch or initialize usage meter record for a workspace and billing period
 */
export function getOrCreateUsageMeter(workspaceId, billingPeriod = getCurrentBillingPeriod(), db = getDb()) {
  let meter = db.prepare(`
    SELECT id, workspace_id, billing_period, runs_count, ai_steps_count, updated_at
    FROM usage_meters
    WHERE workspace_id = ? AND billing_period = ?
  `).get(workspaceId, billingPeriod);

  if (!meter) {
    const meterId = `meter_${crypto.randomUUID().replace(/-/g, '')}`;
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO usage_meters (id, workspace_id, billing_period, runs_count, ai_steps_count, updated_at)
      VALUES (?, ?, ?, 0, 0, ?)
    `).run(meterId, workspaceId, billingPeriod, nowIso);

    meter = {
      id: meterId,
      workspace_id: workspaceId,
      billing_period: billingPeriod,
      runs_count: 0,
      ai_steps_count: 0,
      updated_at: nowIso
    };
  }

  return meter;
}

/**
 * Get active subscription for a workspace
 */
export function getSubscription(workspaceId, db = getDb()) {
  let sub = db.prepare(`
    SELECT id, workspace_id, stripe_customer_id, stripe_subscription_id,
           plan_id, status, current_period_start, current_period_end,
           cancel_at_period_end, updated_at
    FROM subscriptions
    WHERE workspace_id = ?
  `).get(workspaceId);

  if (!sub) {
    // Default to free subscription if none recorded
    const nowIso = new Date().toISOString();
    const periodEndIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const subId = `sub_${crypto.randomUUID().replace(/-/g, '')}`;

    db.prepare(`
      INSERT INTO subscriptions (id, workspace_id, plan_id, status, current_period_start, current_period_end)
      VALUES (?, ?, 'free', 'active', ?, ?)
    `).run(subId, workspaceId, nowIso, periodEndIso);

    sub = {
      id: subId,
      workspace_id: workspaceId,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      plan_id: 'free',
      status: 'active',
      current_period_start: nowIso,
      current_period_end: periodEndIso,
      cancel_at_period_end: 0,
      updated_at: nowIso
    };
  }

  return sub;
}

/**
 * Non-destructive quota check for a workspace (F-BILL-07)
 */
export function checkQuota(workspaceId, db = getDb()) {
  const currentPeriod = getCurrentBillingPeriod();
  const sub = getSubscription(workspaceId, db);
  const planId = (sub && sub.plan_id) ? sub.plan_id : 'free';
  const tier = getTier(planId);
  const limit = tier.monthly_runs;

  const meter = getOrCreateUsageMeter(workspaceId, currentPeriod, db);
  const runsUsed = meter.runs_count || 0;
  const allowed = runsUsed < limit;
  const percentage = Math.min(100, Math.round((runsUsed / limit) * 100));

  return {
    allowed,
    plan_id: planId,
    planId: planId,
    plan: planId,
    plan_name: tier.name,
    planName: tier.name,
    runs_used: runsUsed,
    runsUsed: runsUsed,
    runs_limit: limit,
    runsLimit: limit,
    limit,
    ai_steps_used: meter.ai_steps_count || 0,
    aiStepsUsed: meter.ai_steps_count || 0,
    workflows_limit: tier.max_workflows,
    workflowsLimit: tier.max_workflows,
    percentage,
    resets_at: sub.current_period_end
  };
}

/**
 * Pre-flight Quota Gatekeeper & Atomic Counter Increment (F-BILL-06, F-BILL-07)
 * Strictly blocks execution with HTTP 429 when runs_count >= limit.
 */
export function checkAndIncrementQuota(workspaceId, db = getDb()) {
  const currentPeriod = getCurrentBillingPeriod();

  // 1. Resolve active subscription plan
  const sub = getSubscription(workspaceId, db);
  const planId = (sub && sub.plan_id) ? sub.plan_id : 'free';
  const tier = getTier(planId);
  const limit = tier.monthly_runs;

  // 2. Fetch or initialize usage meter record
  const meter = getOrCreateUsageMeter(workspaceId, currentPeriod, db);

  // 3. Quota check: if runs_count >= limit, block immediately
  if (meter.runs_count >= limit) {
    const err = new Error(`Plan limit of ${limit} runs reached. Please upgrade to Pro.`);
    err.statusCode = 429;
    err.code = 'QUOTA_EXCEEDED';
    err.plan = planId;
    err.current_usage = meter.runs_count;
    err.limit = limit;
    throw err;
  }

  // 4. Atomically increment runs_count
  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE usage_meters
    SET runs_count = runs_count + 1, updated_at = ?
    WHERE id = ?
  `).run(nowIso, meter.id);

  return {
    allowed: true,
    plan: planId,
    plan_id: planId,
    planId: planId,
    runs_used: meter.runs_count + 1,
    runsUsed: meter.runs_count + 1,
    runs_limit: limit,
    runsLimit: limit,
    limit
  };
}

/**
 * Atomically increments usage counters (runs_count, ai_steps_count)
 */
export function incrementUsage(workspaceId, { runs = 0, aiSteps = 0 } = {}, db = getDb()) {
  const currentPeriod = getCurrentBillingPeriod();
  const meter = getOrCreateUsageMeter(workspaceId, currentPeriod, db);
  const nowIso = new Date().toISOString();

  db.prepare(`
    UPDATE usage_meters
    SET runs_count = runs_count + ?,
        ai_steps_count = ai_steps_count + ?,
        updated_at = ?
    WHERE id = ?
  `).run(runs, aiSteps, nowIso, meter.id);

  return {
    runs_count: meter.runs_count + runs,
    ai_steps_count: meter.ai_steps_count + aiSteps
  };
}

/**
 * Retrieve comprehensive usage status for a workspace (F-BILL-08)
 */
export function getUsageStatus(workspaceId, db = getDb()) {
  const currentPeriod = getCurrentBillingPeriod();
  const sub = getSubscription(workspaceId, db);
  const planId = (sub && sub.plan_id) ? sub.plan_id : 'free';
  const tier = getTier(planId);
  const limit = tier.monthly_runs;

  const meter = getOrCreateUsageMeter(workspaceId, currentPeriod, db);
  const runsUsed = meter.runs_count || 0;
  const aiStepsUsed = meter.ai_steps_count || 0;
  const percentage = Math.min(100, Math.round((runsUsed / limit) * 100));

  // Determine billing reset date
  let resetsAt = sub.current_period_end;
  if (!resetsAt) {
    const now = new Date();
    resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  }

  return {
    plan_id: planId,
    planId: planId,
    plan_name: tier.name,
    planName: tier.name,
    price_monthly: tier.price_monthly,
    priceMonthlyUsd: tier.priceMonthlyUsd,
    runs_used: runsUsed,
    runsUsed: runsUsed,
    runs_limit: limit,
    runsLimit: limit,
    ai_steps_used: aiStepsUsed,
    aiStepsUsed: aiStepsUsed,
    workflows_limit: tier.max_workflows,
    workflowsLimit: tier.max_workflows,
    percentage,
    resets_at: resetsAt,
    resetsAt: resetsAt,
    billing_period: currentPeriod
  };
}
