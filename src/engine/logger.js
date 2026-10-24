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

    // M-3 / P7: Bound stored input_data to prevent unbounded storage bloating
    const rawInput = JSON.stringify(inputData);
    const boundedInput = rawInput.length > 100000
      ? JSON.stringify({ truncated: true, preview: rawInput.slice(0, 10000) })
      : rawInput;

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
      boundedInput,
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
    let normalized = errorDetails;
    if (errorDetails instanceof Error) {
      normalized = {
        code: errorDetails.code || 'ERROR',
        message: errorDetails.message,
        name: errorDetails.name,
        stack: process.env.NODE_ENV === 'production' ? undefined : errorDetails.stack
      };
    } else if (errorDetails && typeof errorDetails === 'object') {
      normalized = { ...errorDetails };
      if (process.env.NODE_ENV === 'production') {
        delete normalized.stack;
      }
    }

    const completedAtIso = new Date().toISOString();

    db.prepare(`
      UPDATE step_execution_logs
      SET status = 'failed', error_details = ?, duration_ms = ?, completed_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(normalized),
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

    const rawInput = JSON.stringify(inputData);
    const boundedInput = rawInput.length > 100000
      ? JSON.stringify({ truncated: true, preview: rawInput.slice(0, 10000) })
      : rawInput;

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
      boundedInput,
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

    return rows.map((row) => {
      let errorDetails = row.error_details ? JSON.parse(row.error_details) : null;
      if (errorDetails && typeof errorDetails === 'object' && process.env.NODE_ENV === 'production') {
        const sanitized = { ...errorDetails };
        delete sanitized.stack;
        errorDetails = sanitized;
      }
      return {
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
        error_details: errorDetails,
        duration_ms: row.duration_ms ?? 0,
        started_at: row.started_at,
        completed_at: row.completed_at
      };
    });
  }
}
