import { Router } from 'express';
import { authenticate } from '../auth/middleware.js';
import {
  createWorkflow,
  getWorkflow,
  listWorkflows,
  updateWorkflow,
  deleteWorkflow,
  listExecutions,
  getExecution,
  getExecutionTrace
} from './service.js';
import { dispatchManualTrigger } from '../triggers/manual.js';
import { dispatchWebhookTrigger } from '../triggers/webhook.js';
import { dispatchFileUploadTrigger, parseMultipartFormData } from '../triggers/file_upload.js';

const workflowRouter = Router();
const executionRouter = Router();

// =========================================================================
// 1. Workflow Triggers (Mounted under /api/workflows/triggers)
// =========================================================================

// Public Webhook Trigger (No Bearer token required)
workflowRouter.post('/triggers/webhook/:token', async (req, res, next) => {
  try {
    const execution = await dispatchWebhookTrigger({
      token: req.params.token,
      payload: req.body
    });

    res.status(200).json({
      execution_id: execution.id,
      execution,
      status: execution.status,
      duration_ms: execution.duration_ms
    });
  } catch (err) {
    next(err);
  }
});

// Manual Trigger Dispatcher (POST /api/workflows/triggers/manual)
workflowRouter.post('/triggers/manual', authenticate, async (req, res, next) => {
  try {
    const workflowId = req.body.workflow_id || req.body.workflowId;
    if (!workflowId) {
      const err = new Error('workflow_id is required');
      err.statusCode = 400;
      err.code = 'MISSING_WORKFLOW_ID';
      throw err;
    }
    const execution = await dispatchManualTrigger({
      workflowId,
      workspaceId: req.workspaceId,
      payload: req.body.payload || req.body,
      userId: req.user?.id
    });

    res.status(200).json({
      execution_id: execution.id,
      execution,
      status: execution.status,
      duration_ms: execution.duration_ms,
      output_summary: execution.output_summary
    });
  } catch (err) {
    next(err);
  }
});

// Multipart File Upload Trigger (POST /api/workflows/triggers/upload/:id)
workflowRouter.post('/triggers/upload/:id', authenticate, async (req, res, next) => {
  try {
    const contentType = req.headers['content-type'] || '';
    let file = null;

    if (contentType.includes('multipart/form-data')) {
      const { files } = await parseMultipartFormData(req);
      file = files.find((f) => f.fieldName === 'file') || files[0] || null;
    }

    if (!file && req.body && req.body.file) {
      file = {
        filename: req.body.file.name || 'uploaded_document.txt',
        mimeType: req.body.file.type || 'text/plain',
        size: req.body.file.size || 0,
        buffer: Buffer.from(req.body.file.content || '', 'utf-8')
      };
    }

    const result = await dispatchFileUploadTrigger({
      workflowId: req.params.id,
      workspaceId: req.workspaceId,
      file,
      userId: req.user?.id
    });

    res.status(200).json({
      execution_id: result.execution.id,
      execution: result.execution,
      fileId: result.fileId,
      status: result.execution.status,
      duration_ms: result.execution.duration_ms
    });
  } catch (err) {
    next(err);
  }
});

// =========================================================================
// 2. Workflow CRUD & Run (Tenant Scoped: req.workspaceId)
// =========================================================================

// List workflows
workflowRouter.get('/', authenticate, (req, res, next) => {
  try {
    const workflows = listWorkflows(req.workspaceId);
    res.status(200).json({ workflows });
  } catch (err) {
    next(err);
  }
});

// Create workflow
workflowRouter.post('/', authenticate, (req, res, next) => {
  try {
    const workflow = createWorkflow(req.workspaceId, req.body);
    res.status(201).json({ workflow });
  } catch (err) {
    next(err);
  }
});

// Get workflow by ID
workflowRouter.get('/:id', authenticate, (req, res, next) => {
  try {
    const workflow = getWorkflow(req.workspaceId, req.params.id);
    res.status(200).json({ workflow });
  } catch (err) {
    next(err);
  }
});

// Update workflow by ID
workflowRouter.put('/:id', authenticate, (req, res, next) => {
  try {
    const workflow = updateWorkflow(req.workspaceId, req.params.id, req.body);
    res.status(200).json({ workflow });
  } catch (err) {
    next(err);
  }
});

// Delete workflow by ID
workflowRouter.delete('/:id', authenticate, (req, res, next) => {
  try {
    const result = deleteWorkflow(req.workspaceId, req.params.id);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// Manual Run Trigger (POST /api/workflows/:id/run)
workflowRouter.post('/:id/run', authenticate, async (req, res, next) => {
  try {
    const payload = req.body?.payload !== undefined ? req.body.payload : req.body;
    const execution = await dispatchManualTrigger({
      workflowId: req.params.id,
      workspaceId: req.workspaceId,
      payload,
      userId: req.user?.id
    });

    res.status(200).json({
      execution_id: execution.id,
      execution,
      status: execution.status,
      duration_ms: execution.duration_ms,
      output_summary: execution.output_summary
    });
  } catch (err) {
    next(err);
  }
});

// =========================================================================
// 3. Execution History & Trace Routes (Mounted under /api/executions)
// =========================================================================

// List executions
executionRouter.get('/', authenticate, (req, res, next) => {
  try {
    const executions = listExecutions(req.workspaceId, req.query);
    res.status(200).json({ executions });
  } catch (err) {
    next(err);
  }
});

// Get execution summary
executionRouter.get('/:id', authenticate, (req, res, next) => {
  try {
    const execution = getExecution(req.workspaceId, req.params.id);
    res.status(200).json({ execution });
  } catch (err) {
    next(err);
  }
});

// Get execution trace with granular step-level logs
executionRouter.get('/:id/trace', authenticate, (req, res, next) => {
  try {
    const trace = getExecutionTrace(req.workspaceId, req.params.id);
    res.status(200).json(trace);
  } catch (err) {
    next(err);
  }
});

export { workflowRouter, executionRouter };
export default workflowRouter;
