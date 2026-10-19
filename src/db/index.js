import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { runMigrations } from './migrations.js';

let currentDb = null;

export function initDb(dbPath = process.env.DATABASE_PATH || './data/saas.db') {
  if (currentDb) {
    return currentDb;
  }

  if (dbPath !== ':memory:') {
    const resolvedPath = path.resolve(process.cwd(), dbPath);
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    currentDb = new DatabaseSync(resolvedPath);
    currentDb.exec('PRAGMA journal_mode = WAL;');
  } else {
    currentDb = new DatabaseSync(':memory:');
  }

  currentDb.exec('PRAGMA foreign_keys = ON;');
  runMigrations(currentDb);
  return currentDb;
}

export function getDb() {
  if (!currentDb) {
    return initDb();
  }
  return currentDb;
}

export function setDb(db) {
  currentDb = db;
  return currentDb;
}

export function closeDb() {
  if (currentDb) {
    currentDb.close();
    currentDb = null;
  }
}

export function transaction(fn, db = getDb()) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export { runMigrations };
