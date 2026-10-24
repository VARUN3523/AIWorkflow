import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import authRoutes from './auth/routes.js';
import workspaceRoutes from './workspaces/routes.js';
import { workflowRouter, executionRouter } from './workflows/routes.js';
import { billingRouter, webhookRouter } from './billing/routes.js';
import uiRouter from './ui/routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '../public');

const app = express();

// Standard middleware with raw body capture for webhook signature verification (M-3 / P7 remediation: 2mb limit)
app.use(
  express.json({
    limit: '2mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  })
);
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve public static assets
app.use(express.static(publicDir));

// Mount modular API routers
app.use('/api/auth', authRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/workflows', workflowRouter);
app.use('/api/executions', executionRouter);
app.use('/api/billing', billingRouter);
app.use('/api/webhooks', webhookRouter);

// Mount Web UI routes (Landing page, Auth views, Dashboard)
app.use('/', uiRouter);

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Global defensive error handling boundary
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500;
  const errorCode =
    err.code ||
    (statusCode === 400 ? 'MALFORMED_JSON_PAYLOAD' : statusCode === 429 ? 'QUOTA_EXCEEDED' : 'INTERNAL_ERROR');

  const payload = {
    error: errorCode,
    message: err.message || 'An unexpected error occurred',
  };

  if (err.plan) payload.plan = err.plan;
  if (err.current_usage !== undefined) payload.current_usage = err.current_usage;
  if (err.limit !== undefined) payload.limit = err.limit;

  res.status(statusCode).json(payload);
});

export default app;

