import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { stepRegistry } from '../engine/registry.js';
import { TraceLogger } from '../engine/logger.js';

const VALID_STATUSES = ['active', 'paused', 'draft'];
const VALID_TRIGGER_TYPES = ['manual', 'webhook', 'file_upload'];

/**
 * Normalizes a database workflow row into a parsed JS object
 */
export function formatWorkflow(row, memberRole = null) {
  if (!row) return null;
  const triggerConfig = row.trigger_config ? JSON.parse(row.trigger_config) : {};

  // Redact/mask sensitive webhook trigger tokens for viewer roles (M-6 / P3 remediation)
  if (memberRole === 'viewer' && triggerConfig) {
    if (triggerConfig.webhook_token) {
      triggerConfig.webhook_token = 'whsec_****';
    }
    if (triggerConfig.token) {
      triggerConfig.token = 'whsec_****';
    }
  }

  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    description: row.description,
    trigger_type: row.trigger_type,
    trigger_config: triggerConfig,
    steps: row.steps ? JSON.parse(row.steps) : [],
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

/**
 * Normalizes an execution row into a parsed JS object
 */
export function formatExecution(row) {
  if (!row) return null;
  return {
    id: row.id,
    execution_id: row.id,
    workspace_id: row.workspace_id,
    workflow_id: row.workflow_id,
    trigger_type: row.trigger_type,
    trigger_payload: row.trigger_payload ? JSON.parse(row.trigger_payload) : null,
    status: row.status,
    started_at: row.started_at,
    completed_at: row.completed_at,
    duration_ms: row.duration_ms,
    error_message: row.error_message,
    output_summary: row.output_summary ? JSON.parse(row.output_summary) : null
  };
}

/**
 * Validates step definitions
 */
function validateSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    const err = new Error('Workflow must have at least one processing step');
    err.statusCode = 400;
    err.code = 'INVALID_STEPS';
    throw err;
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || typeof step !== 'object') {
      const err = new Error(`Step at index ${i} is invalid`);
      err.statusCode = 400;
      err.code = 'INVALID_STEP_SCHEMA';
      throw err;
    }

    if (!step.type || !stepRegistry.hasStep(step.type)) {
      const err = new Error(`Unsupported step processor type: ${step.type}`);
      err.statusCode = 400;
      err.code = 'INVALID_STEP_TYPE';
      throw err;
    }
  }
}

/**
 * Creates a new workflow scoped to workspaceId
 */
export function createWorkflow(workspaceId, data = {}, db = getDb()) {
  if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
    const err = new Error('Workflow name is required');
    err.statusCode = 400;
    err.code = 'INVALID_NAME';
    throw err;
  }

  validateSteps(data.steps);

  const workflowId = `wf_${crypto.randomUUID().replace(/-/g, '')}`;
  const nowIso = new Date().toISOString();
  const name = data.name.trim();
  const description = data.description ? String(data.description).trim() : null;
  const triggerType = VALID_TRIGGER_TYPES.includes(data.trigger_type) ? data.trigger_type : 'manual';
  const triggerConfig = JSON.stringify(data.trigger_config || {});
  const steps = JSON.stringify(data.steps);
  const status = VALID_STATUSES.includes(data.status) ? data.status : 'active';

  db.prepare(`
    INSERT INTO workflows (
      id, workspace_id, name, description, trigger_type,
      trigger_config, steps, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    workflowId,
    workspaceId,
    name,
    description,
    triggerType,
    triggerConfig,
    steps,
    status,
    nowIso,
    nowIso
  );

  const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
  return formatWorkflow(row);
}

/**
 * Gets a workflow by ID strictly scoped to caller's workspace
 */
export function getWorkflow(workspaceId, workflowId, db = getDb(), memberRole = null) {
  let effectiveDb = db;
  let effectiveRole = memberRole;
  if (typeof db === 'string') {
    effectiveRole = db;
    effectiveDb = getDb();
  }
  const row = (effectiveDb || getDb()).prepare(`
    SELECT * FROM workflows
    WHERE id = ? AND workspace_id = ?
  `).get(workflowId, workspaceId);

  if (!row) {
    const err = new Error('Workflow not found');
    err.statusCode = 404;
    err.code = 'WORKFLOW_NOT_FOUND';
    throw err;
  }

  return formatWorkflow(row, effectiveRole);
}

/**
 * Lists all workflows belonging to caller's workspace
 */
export function listWorkflows(workspaceId, db = getDb(), memberRole = null) {
  let effectiveDb = db;
  let effectiveRole = memberRole;
  if (typeof db === 'string') {
    effectiveRole = db;
    effectiveDb = getDb();
  }
  const rows = (effectiveDb || getDb()).prepare(`
    SELECT * FROM workflows
    WHERE workspace_id = ?
    ORDER BY created_at DESC
  `).all(workspaceId);

  return rows.map((row) => formatWorkflow(row, effectiveRole));
}

/**
 * Updates a workflow strictly scoped to caller's workspace
 */
export function updateWorkflow(workspaceId, workflowId, data = {}, db = getDb()) {
  const existing = getWorkflow(workspaceId, workflowId, db);

  const name = data.name !== undefined ? String(data.name).trim() : existing.name;
  if (!name || name.length === 0) {
    const err = new Error('Workflow name cannot be empty');
    err.statusCode = 400;
    err.code = 'INVALID_NAME';
    throw err;
  }

  if (data.steps !== undefined) {
    validateSteps(data.steps);
  }

  const description = data.description !== undefined ? data.description : existing.description;
  const triggerType = data.trigger_type !== undefined ? data.trigger_type : existing.trigger_type;
  const triggerConfig = data.trigger_config !== undefined ? JSON.stringify(data.trigger_config) : JSON.stringify(existing.trigger_config);
  const steps = data.steps !== undefined ? JSON.stringify(data.steps) : JSON.stringify(existing.steps);
  const status = data.status !== undefined && VALID_STATUSES.includes(data.status) ? data.status : existing.status;
  const nowIso = new Date().toISOString();

  db.prepare(`
    UPDATE workflows
    SET name = ?, description = ?, trigger_type = ?, trigger_config = ?, steps = ?, status = ?, updated_at = ?
    WHERE id = ? AND workspace_id = ?
  `).run(
    name,
    description,
    triggerType,
    triggerConfig,
    steps,
    status,
    nowIso,
    workflowId,
    workspaceId
  );

  const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
  return formatWorkflow(row);
}

/**
 * Deletes a workflow strictly scoped to caller's workspace
 */
export function deleteWorkflow(workspaceId, workflowId, db = getDb()) {
  getWorkflow(workspaceId, workflowId, db); // Throws 404 if not found or belongs to another tenant

  db.prepare(`
    DELETE FROM workflows
    WHERE id = ? AND workspace_id = ?
  `).run(workflowId, workspaceId);

  return { success: true, message: 'Workflow deleted successfully' };
}

/**
 * Lists executions for caller's workspace with optional filtering
 */
export function listExecutions(workspaceId, query = {}, db = getDb()) {
  const { workflow_id, workflowId, status, limit = 50, offset = 0 } = query;
  const targetWorkflowId = workflow_id || workflowId;

  let sql = 'SELECT * FROM workflow_executions WHERE workspace_id = ?';
  const params = [workspaceId];

  if (targetWorkflowId) {
    sql += ' AND workflow_id = ?';
    params.push(targetWorkflowId);
  }

  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }

  sql += ' ORDER BY started_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit) || 50, Number(offset) || 0);

  const rows = db.prepare(sql).all(...params);
  return rows.map(formatExecution);
}

/**
 * Gets execution details strictly scoped to caller's workspace
 */
export function getExecution(workspaceId, executionId, db = getDb()) {
  const row = db.prepare(`
    SELECT * FROM workflow_executions
    WHERE id = ? AND workspace_id = ?
  `).get(executionId, workspaceId);

  if (!row) {
    const err = new Error('Execution record not found');
    err.statusCode = 404;
    err.code = 'EXECUTION_NOT_FOUND';
    throw err;
  }

  return formatExecution(row);
}

/**
 * Gets step-level trace logs for an execution strictly scoped to caller's workspace
 */
export function getExecutionTrace(workspaceId, executionId, db = getDb()) {
  const execution = getExecution(workspaceId, executionId, db);
  const steps = TraceLogger.getExecutionLogs(executionId, workspaceId, db);

  return {
    execution,
    steps
  };
}
