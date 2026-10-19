import { validateSession } from './service.js';
import { getDb } from '../db/index.js';

export function extractBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && typeof authHeader === 'string') {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      return parts[1];
    }
  }

  if (req.headers['x-session-token']) {
    return req.headers['x-session-token'];
  }

  if (req.headers.cookie) {
    const cookies = Object.fromEntries(
      req.headers.cookie.split(';').map((c) => {
        const [k, ...v] = c.trim().split('=');
        return [k, v.join('=')];
      })
    );
    if (cookies.session_token) {
      return cookies.session_token;
    }
  }

  return null;
}

/**
 * Validates session token and injects req.user and req.sessionToken
 */
export function requireAuth(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentication token is required',
    });
  }

  const session = validateSession(token);
  if (!session) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Invalid or expired session token',
    });
  }

  req.user = session.user;
  req.sessionToken = token;
  req.activeWorkspaceId = session.activeWorkspaceId;
  next();
}

/**
 * Standard tenant middleware: Validates auth, resolves active workspace,
 * verifies membership, and injects req.workspaceId and req.memberRole
 */
export function authenticate(req, res, next) {
  requireAuth(req, res, () => {
    const db = getDb();
    const requestedWorkspaceId =
      req.headers['x-workspace-id'] ||
      req.params.workspaceId ||
      req.activeWorkspaceId ||
      req.user.defaultWorkspaceId;

    if (!requestedWorkspaceId) {
      return res.status(400).json({
        error: 'MISSING_WORKSPACE',
        message: 'No active workspace associated with session or request',
      });
    }

    const membership = db.prepare(`
      SELECT workspace_id, role
      FROM workspace_members
      WHERE user_id = ? AND workspace_id = ?
    `).get(req.user.id, requestedWorkspaceId);

    if (!membership) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'You do not have access to this workspace',
      });
    }

    req.workspaceId = membership.workspace_id;
    req.memberRole = membership.role;
    next();
  });
}

/**
 * RBAC guard middleware
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.memberRole) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Workspace role not determined',
      });
    }

    if (!allowedRoles.includes(req.memberRole)) {
      return res.status(403).json({
        error: 'INSUFFICIENT_PERMISSIONS',
        message: `Action requires one of: ${allowedRoles.join(', ')}. Current role: ${req.memberRole}`,
      });
    }

    next();
  };
}
