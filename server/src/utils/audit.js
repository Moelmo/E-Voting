import { db } from '../db/index.js';

export function logAudit(actor, action, detail = '', ip = '') {
  try {
    const stmt = db.prepare('INSERT INTO audit_logs (actor, action, detail, ip) VALUES (?, ?, ?, ?)');
    stmt.run(actor, action, detail, ip);
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}
