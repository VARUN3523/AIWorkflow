import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { switchSessionWorkspace } from '../auth/service.js';
import {
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  listMembers,
  addMember,
  updateMemberRole,
  removeMember,
} from './service.js';

const router = Router();

// All workspace routes require valid authentication
router.use(requireAuth);

// GET /api/workspaces
router.get('/', (req, res, next) => {
  try {
    const workspaces = listWorkspaces(req.user.id);
    return res.status(200).json({ workspaces });
  } catch (err) {
    next(err);
  }
});

// POST /api/workspaces
router.post('/', (req, res, next) => {
  try {
    const { name } = req.body || {};
    const workspace = createWorkspace(req.user.id, { name });
    return res.status(201).json({ workspace });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'BAD_REQUEST', message: err.message });
    }
    next(err);
  }
});

// GET /api/workspaces/:id
router.get('/:id', (req, res, next) => {
  try {
    const workspace = getWorkspace(req.params.id, req.user.id);
    return res.status(200).json({ workspace });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'NOT_FOUND', message: err.message });
    }
    next(err);
  }
});

// PUT /api/workspaces/:id
router.put('/:id', (req, res, next) => {
  try {
    const { name } = req.body || {};
    const workspace = updateWorkspace(req.params.id, req.user.id, { name });
    return res.status(200).json({ workspace });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'BAD_REQUEST', message: err.message });
    }
    next(err);
  }
});

// DELETE /api/workspaces/:id
router.delete('/:id', (req, res, next) => {
  try {
    const result = deleteWorkspace(req.params.id, req.user.id);
    return res.status(200).json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'FORBIDDEN', message: err.message });
    }
    next(err);
  }
});

// GET /api/workspaces/:id/members
router.get('/:id/members', (req, res, next) => {
  try {
    const members = listMembers(req.params.id, req.user.id);
    return res.status(200).json({ members });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'NOT_FOUND', message: err.message });
    }
    next(err);
  }
});

// POST /api/workspaces/:id/members
router.post('/:id/members', (req, res, next) => {
  try {
    const { email, role } = req.body || {};
    const member = addMember(req.params.id, req.user.id, { email, role });
    return res.status(201).json({ member });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'BAD_REQUEST', message: err.message });
    }
    next(err);
  }
});

// PUT /api/workspaces/:id/members/:userId
router.put('/:id/members/:userId', (req, res, next) => {
  try {
    const { role } = req.body || {};
    const member = updateMemberRole(req.params.id, req.user.id, req.params.userId, role);
    return res.status(200).json({ member });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'BAD_REQUEST', message: err.message });
    }
    next(err);
  }
});

// DELETE /api/workspaces/:id/members/:userId
router.delete('/:id/members/:userId', (req, res, next) => {
  try {
    const result = removeMember(req.params.id, req.user.id, req.params.userId);
    return res.status(200).json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'BAD_REQUEST', message: err.message });
    }
    next(err);
  }
});

// POST /api/workspaces/:id/switch
router.post('/:id/switch', (req, res, next) => {
  try {
    const result = switchSessionWorkspace(req.sessionToken, req.params.id);
    return res.status(200).json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'BAD_REQUEST', message: err.message });
    }
    next(err);
  }
});

export default router;
