import { Router } from 'express';
import { renderLandingPage } from './templates/landing.js';
import { renderDashboardPage } from './templates/dashboard.js';
import { renderLoginPage, renderRegisterPage } from './templates/auth.js';
import { authenticate } from '../auth/middleware.js';
import { getDb } from '../db/index.js';
import { getUsageStatus } from '../billing/service.js';

const router = Router();

// =========================================================================
// 1. Public Marketing Landing Page (Feature F-UI-01)
// =========================================================================
router.get('/', (req, res) => {
  const html = renderLandingPage();
  res.status(200).type('html').send(html);
});

router.get('/marketing', (req, res) => {
  const html = renderLandingPage();
  res.status(200).type('html').send(html);
});

// =========================================================================
// 2. Authentication Views (Login & Register)
// =========================================================================
router.get('/login', (req, res) => {
  const html = renderLoginPage();
  res.status(200).type('html').send(html);
});

router.get('/register', (req, res) => {
  const html = renderRegisterPage();
  res.status(200).type('html').send(html);
});

// =========================================================================
// 3. Customer Dashboard View (Features F-UI-02 to F-UI-09)
// =========================================================================
function handleDashboardView(req, res) {
  const html = renderDashboardPage({
    user: req.user || null,
    workspace: req.workspaceId ? { id: req.workspaceId } : null
  });
  res.status(200).type('html').send(html);
}

router.get('/dashboard', handleDashboardView);
router.get('/dashboard.html', handleDashboardView);

// =========================================================================
// 4. Dashboard Metrics API (Feature F-UI-02 / T1-UI-03)
// =========================================================================
router.get('/api/dashboard/stats', authenticate, (req, res, next) => {
  try {
    const db = getDb();
    const workspaceId = req.workspaceId;

    // Workflow counts
    const wfRow = db.prepare(`
      SELECT 
        COUNT(*) AS total_count,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count
      FROM workflows
      WHERE workspace_id = ?
    `).get(workspaceId);

    const totalWorkflows = wfRow?.total_count || 0;
    const activeWorkflows = wfRow?.active_count || 0;

    // Execution counts
    const execRow = db.prepare(`
      SELECT 
        COUNT(*) AS total_count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
        SUM(CASE WHEN status = 'running' OR status = 'pending' THEN 1 ELSE 0 END) AS in_flight_count
      FROM workflow_executions
      WHERE workspace_id = ?
    `).get(workspaceId);

    const totalExecutions = execRow?.total_count || 0;
    const completedExecutions = execRow?.completed_count || 0;
    const failedExecutions = execRow?.failed_count || 0;
    const runningExecutions = execRow?.in_flight_count || 0;

    // Success rate percentage
    const successRate = totalExecutions > 0
      ? Math.round((completedExecutions / totalExecutions) * 100)
      : 100;

    // Usage metering & plan status
    let usage = {
      runs_used: 0,
      runs_limit: 50,
      plan_id: 'free',
      percentage: 0,
      billing_period: new Date().toISOString().slice(0, 7)
    };

    try {
      usage = getUsageStatus(workspaceId, db);
    } catch {
      // Fallback if billing record missing
    }

    const payload = {
      total_workflows: totalWorkflows,
      workflows: totalWorkflows, // Compatible with both property names
      active_workflows: activeWorkflows,
      total_executions: totalExecutions,
      completed_executions: completedExecutions,
      failed_executions: failedExecutions,
      running_executions: runningExecutions,
      success_rate: successRate,
      runs_used: usage.runs_used,
      runs_limit: usage.runs_limit,
      plan_id: usage.plan_id,
      quota_percentage: usage.percentage,
      billing_period: usage.billing_period,
      resets_at: usage.resets_at
    };

    res.status(200).json(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
