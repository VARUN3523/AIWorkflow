import { getDb } from '../db/index.js';
import { executeWorkflow } from '../engine/runner.js';

/**
 * Manual Trigger Dispatcher
 * Dispatches an on-demand workflow execution.
 */
export async function dispatchManualTrigger(
  { workflowId, workspaceId, payload = {}, userId = null },
  db = getDb()
) {
  const workflowRow = db.prepare(`
    SELECT * FROM workflows
    WHERE id = ? AND workspace_id = ?
  `).get(workflowId, workspaceId);

  if (!workflowRow) {
    const err = new Error('Workflow not found');
    err.statusCode = 404;
    err.code = 'WORKFLOW_NOT_FOUND';
    throw err;
  }

  const workflow = {
    ...workflowRow,
    trigger_config: JSON.parse(workflowRow.trigger_config || '{}'),
    steps: JSON.parse(workflowRow.steps || '[]')
  };

  const execution = await executeWorkflow(
    {
      workflow,
      workspaceId,
      triggerType: 'manual',
      triggerPayload: payload,
      userId
    },
    db
  );

  return execution;
}
