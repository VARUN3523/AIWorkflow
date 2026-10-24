import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { stepRegistry } from './registry.js';
import { TraceLogger } from './logger.js';
import { resolveVariables } from './variable_resolver.js';
import { checkAndIncrementQuota } from '../billing/service.js';

/**
 * Executes a workflow end-to-end with cumulative context passing,
 * atomic trace persistence, and defensive error boundaries.
 */
export async function executeWorkflow(
  { workflow, workspaceId, triggerType, triggerPayload = {}, userId = null },
  db = getDb()
) {
  // 1. Quota Enforcement Gatekeeper
  checkAndIncrementQuota(workspaceId, db);

  const executionId = `exec_${crypto.randomUUID().replace(/-/g, '')}`;
  const startTime = Date.now();
  const startedAtIso = new Date(startTime).toISOString();

  // Bound stored trigger_payload to avoid storing unbounded blobs in SQLite (M-3 / P7)
  const rawPayloadStr = JSON.stringify(triggerPayload || {});
  const storedPayloadStr = rawPayloadStr.length > 100000
    ? JSON.stringify({ truncated: true, preview: rawPayloadStr.slice(0, 10000) })
    : rawPayloadStr;

  // Record initial execution record in DB
  db.prepare(`
    INSERT INTO workflow_executions (
      id, workspace_id, workflow_id, trigger_type,
      trigger_payload, status, started_at
    ) VALUES (?, ?, ?, ?, ?, 'running', ?)
  `).run(
    executionId,
    workspaceId,
    workflow.id,
    triggerType || workflow.trigger_type || 'manual',
    storedPayloadStr,
    startedAtIso
  );

  // 3. Initialize cumulative context
  const rawTrigger = triggerPayload || {};
  const triggerContext = {
    ...rawTrigger,
    ...(typeof rawTrigger.payload === 'object' && rawTrigger.payload !== null ? rawTrigger.payload : {})
  };
  if (rawTrigger.payload !== undefined) {
    triggerContext.payload = rawTrigger.payload;
  } else {
    triggerContext.payload = rawTrigger;
  }

  const context = {
    trigger: triggerContext,
    steps: {}
  };

  let steps = [];
  if (Array.isArray(workflow.steps)) {
    steps = [...workflow.steps];
  } else if (typeof workflow.steps === 'string') {
    try {
      steps = JSON.parse(workflow.steps);
    } catch {
      steps = [];
    }
  }

  // Sort by order ascending
  steps.sort((a, b) => (a.order || 0) - (b.order || 0));

  let hasFailed = false;
  let executionErrorMessage = null;
  let lastOutputSummary = null;

  try {
    for (let i = 0; i < steps.length; i++) {
      const stepDef = steps[i];
      const stepId = stepDef.id || `step_${i + 1}`;
      const stepName = stepDef.name || `Step ${i + 1}`;
      const stepType = stepDef.type;
      const stepOrder = stepDef.order !== undefined ? stepDef.order : i + 1;

      if (hasFailed) {
        // Record skipped step in DB
        TraceLogger.recordStepSkipped(
          {
            executionId,
            workspaceId,
            stepId,
            stepName,
            stepType,
            stepOrder,
            inputData: {}
          },
          db
        );
        continue;
      }

      const stepStartTime = Date.now();

      // Resolve step config variables against cumulative context
      let resolvedConfig = {};
      try {
        resolvedConfig = resolveVariables(stepDef.config || {}, context);
      } catch (varErr) {
        const durationMs = Date.now() - stepStartTime;
        const logId = TraceLogger.startStepLog(
          {
            executionId,
            workspaceId,
            stepId,
            stepName,
            stepType,
            stepOrder,
            inputData: stepDef.config || {}
          },
          db
        );
        TraceLogger.recordStepFailure(
          logId,
          {
            code: 'VARIABLE_RESOLUTION_ERROR',
            message: varErr.message
          },
          durationMs,
          db
        );
        hasFailed = true;
        executionErrorMessage = `Variable interpolation failed in step ${stepName}: ${varErr.message}`;
        continue;
      }

      // Check step processor registration
      const processor = stepRegistry.getStep(stepType);
      if (!processor) {
        const durationMs = Date.now() - stepStartTime;
        const logId = TraceLogger.startStepLog(
          {
            executionId,
            workspaceId,
            stepId,
            stepName,
            stepType,
            stepOrder,
            inputData: resolvedConfig
          },
          db
        );
        TraceLogger.recordStepFailure(
          logId,
          {
            code: 'UNSUPPORTED_STEP_TYPE',
            message: `Unsupported step processor type: "${stepType}"`
          },
          durationMs,
          db
        );
        hasFailed = true;
        executionErrorMessage = `Unsupported step type "${stepType}"`;
        continue;
      }

      // Record step started log in DB
      const logId = TraceLogger.startStepLog(
        {
          executionId,
          workspaceId,
          stepId,
          stepName,
          stepType,
          stepOrder,
          inputData: resolvedConfig
        },
        db
      );

      // Execute processor
      try {
        const result = await processor.execute({
          step: stepDef,
          config: resolvedConfig,
          context,
          workspaceId,
          executionId
        });

        const stepDurationMs = Date.now() - stepStartTime;

        if (result.status === 'failed') {
          TraceLogger.recordStepFailure(
            logId,
            result.error || { code: 'STEP_EXECUTION_FAILED', message: 'Step execution failed' },
            stepDurationMs,
            db
          );
          hasFailed = true;
          executionErrorMessage = result.error?.message || `Step ${stepName} failed`;
        } else {
          // Success
          TraceLogger.recordStepSuccess(
            logId,
            result.outputData || {},
            stepDurationMs,
            db
          );

          // Update cumulative context for downstream steps
          context.steps[stepId] = {
            input: resolvedConfig,
            output: result.outputData || {},
            status: 'success'
          };

          lastOutputSummary = result.outputData || lastOutputSummary;
        }
      } catch (processorErr) {
        const stepDurationMs = Date.now() - stepStartTime;
        TraceLogger.recordStepFailure(
          logId,
          {
            code: processorErr.code || 'STEP_EXCEPTION',
            message: processorErr.message,
            stack: process.env.NODE_ENV === 'production' ? undefined : processorErr.stack
          },
          stepDurationMs,
          db
        );
        hasFailed = true;
        executionErrorMessage = processorErr.message;
      }
    }
  } catch (loopErr) {
    hasFailed = true;
    executionErrorMessage = loopErr.message;
  }

  const totalDurationMs = Date.now() - startTime;
  const completedAtIso = new Date().toISOString();
  const finalStatus = hasFailed ? 'failed' : 'completed';

  db.prepare(`
    UPDATE workflow_executions
    SET status = ?, completed_at = ?, duration_ms = ?, error_message = ?, output_summary = ?
    WHERE id = ?
  `).run(
    finalStatus,
    completedAtIso,
    totalDurationMs,
    executionErrorMessage,
    lastOutputSummary ? JSON.stringify(lastOutputSummary) : null,
    executionId
  );

  return {
    id: executionId,
    execution_id: executionId,
    workspace_id: workspaceId,
    workflow_id: workflow.id,
    trigger_type: triggerType || workflow.trigger_type || 'manual',
    status: finalStatus,
    started_at: startedAtIso,
    completed_at: completedAtIso,
    duration_ms: totalDurationMs,
    error_message: executionErrorMessage,
    output_summary: lastOutputSummary
  };
}
