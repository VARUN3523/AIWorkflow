import { getDb } from '../db/index.js';
import { executeWorkflow } from '../engine/runner.js';

/**
 * Webhook Trigger Dispatcher
 * Ingests external public HTTP payloads, resolves matching workflow by token,
 * and executes the pipeline.
 */
export async function dispatchWebhookTrigger({ token, payload = {} }, db = getDb()) {
  if (!token || typeof token !== 'string') {
    const err = new Error('Invalid or missing webhook token');
    err.statusCode = 404;
    err.code = 'INVALID_WEBHOOK_TOKEN';
    throw err;
  }

  // Reject excessively bloated public webhook payloads (M-3 / P7 remediation: 1MB limit)
  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
  const MAX_WEBHOOK_PAYLOAD_BYTES = 1024 * 1024; // 1MB
  if (Buffer.byteLength(payloadString, 'utf-8') > MAX_WEBHOOK_PAYLOAD_BYTES) {
    const err = new Error('Payload too large. Webhook payload exceeds maximum allowed size of 1MB');
    err.statusCode = 413;
    err.code = 'PAYLOAD_TOO_LARGE';
    throw err;
  }

  // Find workflow with trigger_type = 'webhook' and matching token in trigger_config
  const candidateRows = db.prepare(`
    SELECT * FROM workflows
    WHERE trigger_type = 'webhook' AND status = 'active'
  `).all();

  let matchedWorkflow = null;
  for (const row of candidateRows) {
    try {
      const config = JSON.parse(row.trigger_config || '{}');
      if (config.webhook_token === token || config.token === token) {
        matchedWorkflow = {
          ...row,
          trigger_config: config,
          steps: JSON.parse(row.steps || '[]')
        };
        break;
      }
    } catch {
      // Ignore JSON parse errors on malformed configs
    }
  }

  if (!matchedWorkflow) {
    const err = new Error('Webhook trigger not found or inactive');
    err.statusCode = 404;
    err.code = 'WEBHOOK_TOKEN_NOT_FOUND';
    throw err;
  }

  const execution = await executeWorkflow(
    {
      workflow: matchedWorkflow,
      workspaceId: matchedWorkflow.workspace_id,
      triggerType: 'webhook',
      triggerPayload: payload
    },
    db
  );

  return execution;
}
