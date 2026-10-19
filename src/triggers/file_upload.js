import crypto from 'node:crypto';
import path from 'node:path';
import multer from 'multer';
import { getDb } from '../db/index.js';
import { executeWorkflow } from '../engine/runner.js';

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB

const DEFAULT_ALLOWED_MIMES = [
  'text/plain',
  'application/pdf',
  'application/json',
  'text/csv',
  'text/markdown',
  'application/octet-stream'
];

// Reusable multer instance with memory storage and 15MB size ceiling
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 10
  }
}).any();

/**
 * Parses multipart/form-data from an incoming HTTP request using multer.
 * Efficiently enforces the 15MB size limit via streaming busboy parser without CPU or memory exhaustion.
 */
export async function parseMultipartFormData(req) {
  return new Promise((resolve, reject) => {
    if (!req || !req.headers) {
      return resolve({ fields: {}, files: [] });
    }

    const contentType = req.headers['content-type'] || req.headers['Content-Type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return resolve({ fields: {}, files: [] });
    }

    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/i);
    if (!boundaryMatch) {
      return resolve({ fields: {}, files: [] });
    }

    const res = req.res || {};

    upload(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE' || (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE')) {
          const sizeErr = new Error(`File size exceeds maximum limit of 15MB`);
          sizeErr.statusCode = 413;
          sizeErr.code = 'PAYLOAD_TOO_LARGE';
          if (res && typeof res.setHeader === 'function') {
            res.setHeader('Connection', 'close');
          }
          if (typeof req.resume === 'function') {
            req.resume();
          }
          return reject(sizeErr);
        }
        if (err instanceof multer.MulterError) {
          err.statusCode = 400;
        }
        return reject(err);
      }

      const rawFiles = req.files || [];
      const files = rawFiles.map((f) => ({
        fieldName: f.fieldname,
        filename: f.originalname || 'uploaded_document.txt',
        mimeType: f.mimetype,
        size: f.size,
        buffer: f.buffer
      }));

      resolve({
        fields: req.body || {},
        files
      });
    });
  });
}

/**
 * Dispatches a file upload trigger execution.
 */
export async function dispatchFileUploadTrigger(
  { workflowId, workspaceId, file, userId = null },
  db = getDb()
) {
  if (!file) {
    const err = new Error('No file was uploaded');
    err.statusCode = 400;
    err.code = 'MISSING_FILE';
    throw err;
  }

  // 1. File size limit validation
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const err = new Error(`File size (${file.size} bytes) exceeds maximum limit of 15MB`);
    err.statusCode = 413;
    err.code = 'PAYLOAD_TOO_LARGE';
    throw err;
  }

  // 2. MIME type check
  const allowedMimes = DEFAULT_ALLOWED_MIMES;
  const isMimeAllowed = allowedMimes.includes(file.mimeType) || file.mimeType.startsWith('text/');
  if (!isMimeAllowed) {
    const err = new Error(`Unsupported media type: ${file.mimeType}`);
    err.statusCode = 415;
    err.code = 'UNSUPPORTED_MEDIA_TYPE';
    throw err;
  }

  // 3. Resolve workflow
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

  // 4. Save file metadata in uploaded_files table
  const fileId = `file_${crypto.randomUUID().replace(/-/g, '')}`;
  const nowIso = new Date().toISOString();
  const originalFilename = file.filename || 'uploaded_document.txt';
  const storedPath = `uploads/${fileId}_${path.basename(originalFilename)}`;

  db.prepare(`
    INSERT INTO uploaded_files (
      id, workspace_id, original_name, stored_path, mime_type, size_bytes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    fileId,
    workspaceId,
    originalFilename,
    storedPath,
    file.mimeType,
    file.size,
    nowIso
  );

  // 5. Extract text from file buffer
  const documentText = file.buffer ? file.buffer.toString('utf-8') : '';

  // 6. Execute workflow
  const execution = await executeWorkflow(
    {
      workflow,
      workspaceId,
      triggerType: 'file_upload',
      triggerPayload: {
        file: {
          id: fileId,
          original_name: file.filename,
          mime_type: file.mimeType,
          size_bytes: file.size
        },
        document_text: documentText
      },
      userId
    },
    db
  );

  return {
    execution,
    execution_id: execution.id,
    fileId,
    file: {
      id: fileId,
      original_name: file.filename,
      mime_type: file.mimeType,
      size_bytes: file.size
    }
  };
}
