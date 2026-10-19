import crypto from 'node:crypto';
import { getDb } from '../db/index.js';

/**
 * Atomic Trace Logger for Step Executions
 * Persists granular input/output snapshots, durations, statuses, and error traces.
 */
export class TraceLogger {
  /**
   * Initializes a step log record with status 'running'
   */
  static startStepLog(
    { executionId, workspaceId, stepId, stepName, stepType, stepOrder, inputData = {} },
    db = getDb()
  ) {
    const logId = `slog_${crypto.randomUUID().replace(/-/g, '')}`;
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO step_execution_logs (
        id, execution_id, workspace_id, step_id, step_name,
        step_type, step_order, status, input_data, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)
    `).run(
      logId,
      executionId,
      workspaceId,
      stepId,
      stepName,
      stepType,
      stepOrder,
      JSON.stringify(inputData),
      nowIso
    );

    return logId;
  }

  static recordStepSuccess(logId, outputData = {}, durationMs = 0, db = getDb()) {
    const completedAtIso = new Date().toISOString();

    db.prepare(`
      UPDATE step_execution_logs
      SET status = 'success', output_data = ?, duration_ms = ?, completed_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(outputData),
      durationMs,
      completedAtIso,
      logId
    );
  }

  static recordStepFailure(logId, errorDetails = {}, durationMs = 0, db = getDb()) {
    if (errorDetails instanceof Error) {
      errorDetails = {
        code: errorDetails.code || 'ERROR',
        message: errorDetails.message,
        name: errorDetails.name,
        stack: errorDetails.stack
      };
    }

    const completedAtIso = new Date().toISOString();

    db.prepare(`
      UPDATE step_execution_logs
      SET status = 'failed', error_details = ?, duration_ms = ?, completed_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(errorDetails),
      durationMs,
      completedAtIso,
      logId
    );
  }

  /**
   * Records a skipped step directly
   */
  static recordStepSkipped(
    { executionId, workspaceId, stepId, stepName, stepType, stepOrder, inputData = {} },
    db = getDb()
  ) {
    const logId = `slog_${crypto.randomUUID().replace(/-/g, '')}`;
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO step_execution_logs (
        id, execution_id, workspace_id, step_id, step_name,
        step_type, step_order, status, input_data, duration_ms, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'skipped', ?, 0, ?, ?)
    `).run(
      logId,
      executionId,
      workspaceId,
      stepId,
      stepName,
      stepType,
      stepOrder,
      JSON.stringify(inputData),
      nowIso,
      nowIso
    );

    return logId;
  }

  /**
   * Retrieves all step logs for an execution ordered by step_order ASC
   */
  static getExecutionLogs(executionId, workspaceId, db = getDb()) {
    const rows = db.prepare(`
      SELECT * FROM step_execution_logs
      WHERE execution_id = ? AND workspace_id = ?
      ORDER BY step_order ASC
    `).all(executionId, workspaceId);

    return rows.map((row) => ({
      id: row.id,
      execution_id: row.execution_id,
      workspace_id: row.workspace_id,
      step_id: row.step_id,
      step_name: row.step_name,
      step_type: row.step_type,
      step_order: row.step_order,
      status: row.status,
      input_data: row.input_data ? JSON.parse(row.input_data) : null,
      output_data: row.output_data ? JSON.parse(row.output_data) : null,
      error_details: row.error_details ? JSON.parse(row.error_details) : null,
      duration_ms: row.duration_ms ?? 0,
      started_at: row.started_at,
      completed_at: row.completed_at
    }));
  }
}
