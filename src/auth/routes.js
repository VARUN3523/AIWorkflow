import { Router } from 'express';
import { registerUser, loginUser, logoutUser, getMe } from './service.js';
import { requireAuth, extractBearerToken } from './middleware.js';

const router = Router();

// POST /api/auth/register
router.post('/register', (req, res, next) => {
  try {
    const { email, password, fullName, workspaceName } = req.body || {};
    const result = registerUser({ email, password, fullName, workspaceName });
    return res.status(201).json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'BAD_REQUEST', message: err.message });
    }
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const result = loginUser({ email, password });
    return res.status(200).json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'UNAUTHORIZED', message: err.message });
    }
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res, next) => {
  try {
    const token = extractBearerToken(req);
    const result = logoutUser(token);
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res, next) => {
  try {
    const requestedWorkspaceId = req.headers['x-workspace-id'] || req.activeWorkspaceId;
    const result = getMe(req.user.id, requestedWorkspaceId);
    return res.status(200).json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'BAD_REQUEST', message: err.message });
    }
    next(err);
  }
});

export default router;
