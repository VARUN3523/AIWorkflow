import crypto from 'node:crypto';
import { getDb, transaction } from '../db/index.js';

export function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string');
  }
  if (password.length > 1024) {
    throw new Error('Password exceeds maximum allowed length of 1024 characters');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') {
    return false;
  }
  if (password.length > 1024) {
    return false;
  }
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) {
    return false;
  }
  const computed = crypto.scryptSync(password, salt, 64).toString('hex');
  const bufA = Buffer.from(computed, 'hex');
  const bufB = Buffer.from(hash, 'hex');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function generateSlug(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base}-${suffix}`;
}

export function getCurrentBillingPeriod() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function registerUser({ email, password, fullName, workspaceName }, db = getDb()) {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    const err = new Error('A valid email address is required');
    err.statusCode = 400;
    err.code = 'INVALID_EMAIL';
    throw err;
  }

  if (!password || typeof password !== 'string' || password.length < 8) {
    const err = new Error('Password must be at least 8 characters long');
    err.statusCode = 400;
    err.code = 'WEAK_PASSWORD';
    throw err;
  }

  if (password.length > 1024) {
    const err = new Error('Password cannot exceed 1024 characters');
    err.statusCode = 400;
    err.code = 'PASSWORD_TOO_LONG';
    throw err;
  }

  if (!fullName || typeof fullName !== 'string' || fullName.trim().length === 0) {
    const err = new Error('Full name is required');
    err.statusCode = 400;
    err.code = 'INVALID_NAME';
    throw err;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const trimmedName = fullName.trim();

  // Check existing user
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    const err = new Error('Email already registered');
    err.statusCode = 409;
    err.code = 'EMAIL_ALREADY_EXISTS';
    throw err;
  }

  return transaction(() => {
    const userId = `usr_${crypto.randomUUID().replace(/-/g, '')}`;
    const workspaceId = `ws_${crypto.randomUUID().replace(/-/g, '')}`;
    const wsName = workspaceName && workspaceName.trim().length > 0
      ? workspaceName.trim()
      : `${trimmedName}'s Workspace`;
    const wsSlug = generateSlug(wsName);
    const passwordHash = hashPassword(password);
    const nowIso = new Date().toISOString();
    const billingPeriod = getCurrentBillingPeriod();
    const periodEndIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Create Workspace
    db.prepare(`
      INSERT INTO workspaces (id, name, slug, owner_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(workspaceId, wsName, wsSlug, userId, nowIso, nowIso);

    // 2. Create User
    db.prepare(`
      INSERT INTO users (id, email, password_hash, full_name, default_workspace_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, normalizedEmail, passwordHash, trimmedName, workspaceId, nowIso, nowIso);

    // 3. Create Workspace Membership
    const memberId = `wm_${crypto.randomUUID().replace(/-/g, '')}`;
    db.prepare(`
      INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at)
      VALUES (?, ?, ?, 'owner', ?)
    `).run(memberId, workspaceId, userId, nowIso);

    // 4. Create Default Free Subscription
    const subId = `sub_${crypto.randomUUID().replace(/-/g, '')}`;
    db.prepare(`
      INSERT INTO subscriptions (id, workspace_id, plan_id, status, current_period_start, current_period_end)
      VALUES (?, ?, 'free', 'active', ?, ?)
    `).run(subId, workspaceId, nowIso, periodEndIso);

    // 5. Create Usage Meter
    const meterId = `meter_${crypto.randomUUID().replace(/-/g, '')}`;
    db.prepare(`
      INSERT INTO usage_meters (id, workspace_id, billing_period, runs_count, ai_steps_count, updated_at)
      VALUES (?, ?, ?, 0, 0, ?)
    `).run(meterId, workspaceId, billingPeriod, nowIso);

    // 6. Create Session
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO sessions (id, user_id, active_workspace_id, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(token, userId, workspaceId, nowIso, expiresAt);

    return {
      user: {
        id: userId,
        email: normalizedEmail,
        fullName: trimmedName,
      },
      workspace: {
        id: workspaceId,
        name: wsName,
        slug: wsSlug,
        role: 'owner',
      },
      token,
    };
  }, db);
}

export function loginUser({ email, password }, db = getDb()) {
  if (!email || !password) {
    const err = new Error('Email and password are required');
    err.statusCode = 400;
    err.code = 'MISSING_CREDENTIALS';
    throw err;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = db.prepare(`
    SELECT id, email, password_hash, full_name, default_workspace_id
    FROM users
    WHERE email = ?
  `).get(normalizedEmail);

  if (!user || !verifyPassword(password, user.password_hash)) {
    const err = new Error('Invalid email or password');
    err.statusCode = 401;
    err.code = 'INVALID_CREDENTIALS';
    throw err;
  }

  // Resolve active workspace
  let activeWorkspaceId = user.default_workspace_id;
  const membership = db.prepare(`
    SELECT workspace_id, role
    FROM workspace_members
    WHERE user_id = ? AND workspace_id = ?
  `).get(user.id, activeWorkspaceId);

  if (!membership) {
    const firstMembership = db.prepare(`
      SELECT workspace_id, role
      FROM workspace_members
      WHERE user_id = ?
      ORDER BY created_at ASC
      LIMIT 1
    `).get(user.id);
    activeWorkspaceId = firstMembership ? firstMembership.workspace_id : null;
  }

  // Create session
  const token = generateToken();
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO sessions (id, user_id, active_workspace_id, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, user.id, activeWorkspaceId, nowIso, expiresAt);

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
    },
    activeWorkspaceId,
  };
}

export function logoutUser(token, db = getDb()) {
  if (!token) {
    return { success: true, message: 'Logged out successfully' };
  }
  db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
  return { success: true, message: 'Logged out successfully' };
}

export function validateSession(token, db = getDb()) {
  if (!token) return null;

  const session = db.prepare(`
    SELECT s.id, s.user_id, s.active_workspace_id, s.expires_at,
           u.email, u.full_name, u.default_workspace_id
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ?
  `).get(token);

  if (!session) return null;

  if (new Date(session.expires_at) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
    return null;
  }

  return {
    token: session.id,
    userId: session.user_id,
    activeWorkspaceId: session.active_workspace_id,
    user: {
      id: session.user_id,
      email: session.email,
      fullName: session.full_name,
      defaultWorkspaceId: session.default_workspace_id,
    },
  };
}

export function getMe(userId, requestedWorkspaceId = null, db = getDb()) {
  const user = db.prepare(`
    SELECT id, email, full_name, default_workspace_id, created_at
    FROM users
    WHERE id = ?
  `).get(userId);

  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  const workspaces = db.prepare(`
    SELECT w.id, w.name, w.slug, w.owner_id, wm.role, wm.created_at AS member_since
    FROM workspaces w
    JOIN workspace_members wm ON w.id = wm.workspace_id
    WHERE wm.user_id = ?
    ORDER BY w.created_at ASC
  `).all(userId);

  let activeWorkspace = null;
  if (requestedWorkspaceId) {
    activeWorkspace = workspaces.find((w) => w.id === requestedWorkspaceId);
  }
  if (!activeWorkspace) {
    activeWorkspace = workspaces.find((w) => w.id === user.default_workspace_id) || workspaces[0] || null;
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
    },
    workspaces: workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
      ownerId: w.owner_id,
      role: w.role,
    })),
    activeWorkspace: activeWorkspace ? {
      id: activeWorkspace.id,
      name: activeWorkspace.name,
      slug: activeWorkspace.slug,
      role: activeWorkspace.role,
    } : null,
  };
}

export function switchSessionWorkspace(token, workspaceId, db = getDb()) {
  const session = validateSession(token, db);
  if (!session) {
    const err = new Error('Invalid or expired session');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  const membership = db.prepare(`
    SELECT role FROM workspace_members
    WHERE workspace_id = ? AND user_id = ?
  `).get(workspaceId, session.userId);

  if (!membership) {
    const err = new Error('You are not a member of this workspace');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  db.prepare(`
    UPDATE sessions
    SET active_workspace_id = ?
    WHERE id = ?
  `).run(workspaceId, token);

  return { success: true, activeWorkspaceId: workspaceId };
}
