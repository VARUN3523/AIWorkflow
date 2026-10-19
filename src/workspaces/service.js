import crypto from 'node:crypto';
import { getDb, transaction } from '../db/index.js';
import { generateSlug, getCurrentBillingPeriod } from '../auth/service.js';

export function listWorkspaces(userId, db = getDb()) {
  const rows = db.prepare(`
    SELECT w.id, w.name, w.slug, w.owner_id, wm.role, wm.created_at AS joined_at,
           w.created_at, w.updated_at
    FROM workspaces w
    JOIN workspace_members wm ON w.id = wm.workspace_id
    WHERE wm.user_id = ?
    ORDER BY w.created_at ASC
  `).all(userId);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    ownerId: r.owner_id,
    role: r.role,
    joinedAt: r.joined_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function getWorkspace(workspaceId, userId, db = getDb()) {
  const membership = db.prepare(`
    SELECT role FROM workspace_members
    WHERE workspace_id = ? AND user_id = ?
  `).get(workspaceId, userId);

  if (!membership) {
    const err = new Error('Workspace not found or access denied');
    err.statusCode = 404;
    err.code = 'WORKSPACE_NOT_FOUND';
    throw err;
  }

  const ws = db.prepare(`
    SELECT id, name, slug, owner_id, created_at, updated_at
    FROM workspaces
    WHERE id = ?
  `).get(workspaceId);

  if (!ws) {
    const err = new Error('Workspace not found');
    err.statusCode = 404;
    err.code = 'WORKSPACE_NOT_FOUND';
    throw err;
  }

  const memberCount = db.prepare(`
    SELECT COUNT(*) AS total
    FROM workspace_members
    WHERE workspace_id = ?
  `).get(workspaceId);

  return {
    id: ws.id,
    name: ws.name,
    slug: ws.slug,
    ownerId: ws.owner_id,
    role: membership.role,
    memberCount: memberCount ? memberCount.total : 1,
    createdAt: ws.created_at,
    updatedAt: ws.updated_at,
  };
}

export function createWorkspace(userId, { name }, db = getDb()) {
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    const err = new Error('Workspace name is required');
    err.statusCode = 400;
    err.code = 'INVALID_WORKSPACE_NAME';
    throw err;
  }

  const trimmedName = name.trim();
  const workspaceId = `ws_${crypto.randomUUID().replace(/-/g, '')}`;
  const slug = generateSlug(trimmedName);
  const nowIso = new Date().toISOString();
  const billingPeriod = getCurrentBillingPeriod();
  const periodEndIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  return transaction(() => {
    // 1. Create workspace
    db.prepare(`
      INSERT INTO workspaces (id, name, slug, owner_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(workspaceId, trimmedName, slug, userId, nowIso, nowIso);

    // 2. Add owner membership
    const memberId = `wm_${crypto.randomUUID().replace(/-/g, '')}`;
    db.prepare(`
      INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at)
      VALUES (?, ?, ?, 'owner', ?)
    `).run(memberId, workspaceId, userId, nowIso);

    // 3. Create default subscription
    const subId = `sub_${crypto.randomUUID().replace(/-/g, '')}`;
    db.prepare(`
      INSERT INTO subscriptions (id, workspace_id, plan_id, status, current_period_start, current_period_end)
      VALUES (?, ?, 'free', 'active', ?, ?)
    `).run(subId, workspaceId, nowIso, periodEndIso);

    // 4. Create initial usage meter
    const meterId = `meter_${crypto.randomUUID().replace(/-/g, '')}`;
    db.prepare(`
      INSERT INTO usage_meters (id, workspace_id, billing_period, runs_count, ai_steps_count, updated_at)
      VALUES (?, ?, ?, 0, 0, ?)
    `).run(meterId, workspaceId, billingPeriod, nowIso);

    return {
      id: workspaceId,
      name: trimmedName,
      slug,
      ownerId: userId,
      role: 'owner',
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }, db);
}

export function updateWorkspace(workspaceId, userId, { name }, db = getDb()) {
  const membership = db.prepare(`
    SELECT role FROM workspace_members
    WHERE workspace_id = ? AND user_id = ?
  `).get(workspaceId, userId);

  if (!membership) {
    const err = new Error('Workspace not found or access denied');
    err.statusCode = 404;
    err.code = 'WORKSPACE_NOT_FOUND';
    throw err;
  }

  if (membership.role !== 'owner' && membership.role !== 'admin') {
    const err = new Error('Insufficient permissions to update workspace. Admin or owner required.');
    err.statusCode = 403;
    err.code = 'INSUFFICIENT_PERMISSIONS';
    throw err;
  }

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    const err = new Error('Workspace name is required');
    err.statusCode = 400;
    err.code = 'INVALID_WORKSPACE_NAME';
    throw err;
  }

  const trimmedName = name.trim();
  const nowIso = new Date().toISOString();

  db.prepare(`
    UPDATE workspaces
    SET name = ?, updated_at = ?
    WHERE id = ?
  `).run(trimmedName, nowIso, workspaceId);

  const updated = db.prepare('SELECT id, name, slug, owner_id, created_at, updated_at FROM workspaces WHERE id = ?').get(workspaceId);
  return {
    ...updated,
    role: membership.role,
  };
}

export function deleteWorkspace(workspaceId, userId, db = getDb()) {
  const ws = db.prepare('SELECT id, owner_id FROM workspaces WHERE id = ?').get(workspaceId);
  if (!ws) {
    const err = new Error('Workspace not found');
    err.statusCode = 404;
    err.code = 'WORKSPACE_NOT_FOUND';
    throw err;
  }

  const membership = db.prepare(`
    SELECT role FROM workspace_members
    WHERE workspace_id = ? AND user_id = ?
  `).get(workspaceId, userId);

  if (!membership) {
    const err = new Error('Workspace not found or access denied');
    err.statusCode = 404;
    err.code = 'WORKSPACE_NOT_FOUND';
    throw err;
  }

  if (membership.role !== 'owner') {
    const err = new Error('Only the workspace owner can delete the workspace');
    err.statusCode = 403;
    err.code = 'INSUFFICIENT_PERMISSIONS';
    throw err;
  }

  db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
  return { success: true, message: 'Workspace deleted successfully' };
}

export function listMembers(workspaceId, userId, db = getDb()) {
  const membership = db.prepare(`
    SELECT role FROM workspace_members
    WHERE workspace_id = ? AND user_id = ?
  `).get(workspaceId, userId);

  if (!membership) {
    const err = new Error('Workspace not found or access denied');
    err.statusCode = 404;
    err.code = 'WORKSPACE_NOT_FOUND';
    throw err;
  }

  const members = db.prepare(`
    SELECT wm.id AS membership_id, wm.workspace_id, wm.user_id, wm.role, wm.created_at AS joined_at,
           u.email, u.full_name
    FROM workspace_members wm
    JOIN users u ON wm.user_id = u.id
    WHERE wm.workspace_id = ?
    ORDER BY wm.created_at ASC
  `).all(workspaceId);

  return members.map((m) => ({
    id: m.membership_id,
    workspaceId: m.workspace_id,
    userId: m.user_id,
    email: m.email,
    fullName: m.full_name,
    role: m.role,
    joinedAt: m.joined_at,
  }));
}

export function addMember(workspaceId, callerId, { email, role = 'member' }, db = getDb()) {
  const caller = db.prepare(`
    SELECT role FROM workspace_members
    WHERE workspace_id = ? AND user_id = ?
  `).get(workspaceId, callerId);

  if (!caller) {
    const err = new Error('Workspace not found or access denied');
    err.statusCode = 404;
    err.code = 'WORKSPACE_NOT_FOUND';
    throw err;
  }

  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const err = new Error('Only workspace owners or admins can invite new members');
    err.statusCode = 403;
    err.code = 'INSUFFICIENT_PERMISSIONS';
    throw err;
  }

  const validRoles = ['admin', 'member', 'viewer'];
  if (!validRoles.includes(role)) {
    const err = new Error(`Invalid role '${role}'. Allowed roles: ${validRoles.join(', ')}`);
    err.statusCode = 400;
    err.code = 'INVALID_ROLE';
    throw err;
  }

  if (!email || typeof email !== 'string') {
    const err = new Error('A valid email is required');
    err.statusCode = 400;
    err.code = 'INVALID_EMAIL';
    throw err;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const targetUser = db.prepare('SELECT id, email, full_name FROM users WHERE email = ?').get(normalizedEmail);
  if (!targetUser) {
    const err = new Error(`User with email '${normalizedEmail}' was not found`);
    err.statusCode = 404;
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  const existingMember = db.prepare(`
    SELECT id, role FROM workspace_members
    WHERE workspace_id = ? AND user_id = ?
  `).get(workspaceId, targetUser.id);

  if (existingMember) {
    const err = new Error('User is already a member of this workspace');
    err.statusCode = 409;
    err.code = 'MEMBER_ALREADY_EXISTS';
    throw err;
  }

  const memberId = `wm_${crypto.randomUUID().replace(/-/g, '')}`;
  const nowIso = new Date().toISOString();

  db.prepare(`
    INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(memberId, workspaceId, targetUser.id, role, nowIso);

  return {
    id: memberId,
    workspaceId,
    userId: targetUser.id,
    email: targetUser.email,
    fullName: targetUser.full_name,
    role,
    joinedAt: nowIso,
  };
}

export function updateMemberRole(workspaceId, callerId, targetUserId, newRole, db = getDb()) {
  const caller = db.prepare(`
    SELECT role FROM workspace_members
    WHERE workspace_id = ? AND user_id = ?
  `).get(workspaceId, callerId);

  if (!caller) {
    const err = new Error('Workspace not found or access denied');
    err.statusCode = 404;
    err.code = 'WORKSPACE_NOT_FOUND';
    throw err;
  }

  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const err = new Error('Only workspace owners or admins can update member roles');
    err.statusCode = 403;
    err.code = 'INSUFFICIENT_PERMISSIONS';
    throw err;
  }

  const validRoles = ['admin', 'member', 'viewer'];
  if (!validRoles.includes(newRole)) {
    const err = new Error(`Invalid role '${newRole}'. Allowed roles: ${validRoles.join(', ')}`);
    err.statusCode = 400;
    err.code = 'INVALID_ROLE';
    throw err;
  }

  const ws = db.prepare('SELECT owner_id FROM workspaces WHERE id = ?').get(workspaceId);
  if (targetUserId === ws.owner_id) {
    const err = new Error('Cannot change the role of the workspace owner');
    err.statusCode = 400;
    err.code = 'CANNOT_DEMOTE_OWNER';
    throw err;
  }

  const targetMembership = db.prepare(`
    SELECT id, role FROM workspace_members
    WHERE workspace_id = ? AND user_id = ?
  `).get(workspaceId, targetUserId);

  if (!targetMembership) {
    const err = new Error('Member not found in this workspace');
    err.statusCode = 404;
    err.code = 'MEMBER_NOT_FOUND';
    throw err;
  }

  // Admin cannot modify an admin or owner
  if (caller.role === 'admin' && (targetMembership.role === 'admin' || targetMembership.role === 'owner')) {
    const err = new Error('Admins cannot change roles of other admins or owners');
    err.statusCode = 403;
    err.code = 'INSUFFICIENT_PERMISSIONS';
    throw err;
  }

  db.prepare(`
    UPDATE workspace_members
    SET role = ?
    WHERE workspace_id = ? AND user_id = ?
  `).run(newRole, workspaceId, targetUserId);

  return {
    id: targetMembership.id,
    workspaceId,
    userId: targetUserId,
    role: newRole,
  };
}

export function removeMember(workspaceId, callerId, targetUserId, db = getDb()) {
  const caller = db.prepare(`
    SELECT role FROM workspace_members
    WHERE workspace_id = ? AND user_id = ?
  `).get(workspaceId, callerId);

  if (!caller) {
    const err = new Error('Workspace not found or access denied');
    err.statusCode = 404;
    err.code = 'WORKSPACE_NOT_FOUND';
    throw err;
  }

  const ws = db.prepare('SELECT owner_id FROM workspaces WHERE id = ?').get(workspaceId);
  if (targetUserId === ws.owner_id) {
    const err = new Error('Cannot remove the workspace owner');
    err.statusCode = 400;
    err.code = 'CANNOT_REMOVE_OWNER';
    throw err;
  }

  const targetMembership = db.prepare(`
    SELECT id, role FROM workspace_members
    WHERE workspace_id = ? AND user_id = ?
  `).get(workspaceId, targetUserId);

  if (!targetMembership) {
    const err = new Error('Member not found in this workspace');
    err.statusCode = 404;
    err.code = 'MEMBER_NOT_FOUND';
    throw err;
  }

  const isSelf = callerId === targetUserId;
  const isOwner = caller.role === 'owner';
  const isAdmin = caller.role === 'admin';

  if (!isSelf && !isOwner && !isAdmin) {
    const err = new Error('Insufficient permissions to remove member');
    err.statusCode = 403;
    err.code = 'INSUFFICIENT_PERMISSIONS';
    throw err;
  }

  if (isAdmin && !isOwner && !isSelf && (targetMembership.role === 'admin' || targetMembership.role === 'owner')) {
    const err = new Error('Admins cannot remove other admins or owners');
    err.statusCode = 403;
    err.code = 'INSUFFICIENT_PERMISSIONS';
    throw err;
  }

  db.prepare(`
    DELETE FROM workspace_members
    WHERE workspace_id = ? AND user_id = ?
  `).run(workspaceId, targetUserId);

  return { success: true, message: 'Member removed from workspace' };
}
