import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../src/db/migrations.js';
import { setDb, closeDb } from '../../src/db/index.js';

export function setupTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  setDb(db);

  return {
    db,
    cleanup() {
      try {
        db.close();
      } catch {
        // Ignore if already closed
      }
      setDb(null);
    },
  };
}
