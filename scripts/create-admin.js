// Create an admin account or reset an existing admin's password.
//   npm run admin:create -- <email> <password> [name]
import { db } from '../server/db.js';
import { hashPassword, validatePassword, destroyUserSessions } from '../server/auth.js';

const [email, password, ...nameParts] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: npm run admin:create -- <email> <password> [name]');
  process.exit(1);
}
const err = validatePassword(password);
if (err) {
  console.error(err);
  process.exit(1);
}

const hash = await hashPassword(password);
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existing) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, existing.id);
  destroyUserSessions(existing.id);
  console.log(`Password reset for ${email}.`);
} else {
  db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(nameParts.join(' ') || 'Administrator', email, hash);
  console.log(`Admin ${email} created.`);
}
