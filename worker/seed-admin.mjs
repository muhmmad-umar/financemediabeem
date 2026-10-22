#!/usr/bin/env node
/**
 * Creates (or resets the password of) the first admin account.
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='long-password' node worker/seed-admin.mjs [--local|--remote]
 *
 * Hashes with PBKDF2-SHA256 (100k iterations) — the same format the Worker verifies —
 * then runs the INSERT through `wrangler d1 execute`. Default target is --remote.
 */
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = String(process.env.ADMIN_PASSWORD || '');
const name = String(process.env.ADMIN_NAME || 'Admin');
const target = process.argv.includes('--local') ? '--local' : '--remote';

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error('Set ADMIN_EMAIL to a valid email address.'); process.exit(1); }
if (password.length < 10) { console.error('Set ADMIN_PASSWORD (at least 10 characters).'); process.exit(1); }

const b64u = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const salt = randomBytes(16);
const hash = `pbkdf2$100000$${b64u(salt)}$${b64u(pbkdf2Sync(password, salt, 100000, 32, 'sha256'))}`;
const q = s => `'${String(s).replace(/'/g, "''")}'`;
const id = randomBytes(8).toString('hex');

const sql = `INSERT INTO users (id,email,password_hash,role,name,active) VALUES (${q(id)},${q(email)},${q(hash)},'admin',${q(name)},1)
ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash, active=1, role='admin';`;

const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'mediabeem-db', target, '-c', 'worker/wrangler.toml', '--command', sql], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);
console.log(`\nAdmin ready: ${email}`);
