-- Media Beem Agency Manager — D1 schema (SQLite)
-- Every data table carries the spec columns used for filtering/reporting plus a `data` JSON column
-- holding the full record, so nothing the app stores is ever lost.

-- ===== Users & auth =====
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','employee','client')),
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  active        INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS employee_user (
  employee_id TEXT NOT NULL UNIQUE,
  user_id     TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS client_user (
  client_id TEXT NOT NULL UNIQUE,
  user_id   TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS login_attempts (
  email TEXT NOT NULL,
  ts    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(email, ts);
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ===== Finance =====
CREATE TABLE IF NOT EXISTS income_entries (
  id TEXT PRIMARY KEY, total_amount REAL, received_amount REAL, source TEXT, date TEXT,
  description TEXT, category TEXT, status TEXT, data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY, amount REAL, category TEXT, vendor TEXT, date TEXT, description TEXT,
  data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY, client_id TEXT, total_amount REAL, received_amount REAL, remaining REAL, status TEXT,
  issue_date TEXT, expected_date TEXT, client_type TEXT, data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE TABLE IF NOT EXISTS invoice_payments (
  id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, amount REAL, date TEXT, notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);
CREATE TABLE IF NOT EXISTS allah_share_payments (
  id TEXT PRIMARY KEY, amount REAL, type TEXT, given_to TEXT, date TEXT, notes TEXT,
  data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS recurring_alerts (
  id TEXT PRIMARY KEY, client_id TEXT, frequency_days INTEGER, last_invoice_date TEXT, next_alert_date TEXT, active INTEGER,
  data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0
);

-- ===== Team =====
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY, name TEXT, role TEXT, salary REAL, join_date TEXT, bank_name TEXT, account_number TEXT,
  phone TEXT, email TEXT, status TEXT, data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS salary_payments (
  id TEXT PRIMARY KEY, employee_id TEXT, month TEXT, amount REAL, date TEXT, method TEXT, notes TEXT, is_prorata INTEGER DEFAULT 0,
  data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_salary_employee ON salary_payments(employee_id);
CREATE TABLE IF NOT EXISTS employee_leaves (
  id TEXT PRIMARY KEY, employee_id TEXT, date TEXT, type TEXT, notes TEXT, data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0
);

-- ===== Clients =====
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY, name TEXT, contact TEXT, email TEXT, phone TEXT, status TEXT, client_type TEXT, retainer_amount REAL,
  data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0
);

-- ===== Tasks workspace (Space → List → Task → Subtask) =====
CREATE TABLE IF NOT EXISTS cu_spaces (
  id TEXT PRIMARY KEY, name TEXT, client_id TEXT, color TEXT, data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cu_lists (
  id TEXT PRIMARY KEY, space_id TEXT, name TEXT, color TEXT, client_id TEXT, data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lists_space ON cu_lists(space_id);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, list_id TEXT, title TEXT, description TEXT, assignee_id TEXT, due_date TEXT, priority TEXT, status TEXT,
  tags TEXT, time_estimate REAL, data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks(list_id);
CREATE TABLE IF NOT EXISTS subtasks (
  id TEXT PRIMARY KEY, task_id TEXT, title TEXT, completed INTEGER DEFAULT 0, data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);
CREATE TABLE IF NOT EXISTS task_comments (
  id TEXT PRIMARY KEY, task_id TEXT, author_id TEXT, author_name TEXT, text TEXT, timestamp TEXT,
  client_visible INTEGER NOT NULL DEFAULT 0, kind TEXT DEFAULT 'comment', data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_comments_task ON task_comments(task_id);
CREATE TABLE IF NOT EXISTS task_time_logs (
  id TEXT PRIMARY KEY, task_id TEXT, hours REAL, date TEXT, note TEXT, by_name TEXT, data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS list_messages (
  id TEXT PRIMARY KEY, scope TEXT, author_name TEXT, text TEXT, timestamp TEXT, data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS resource_folders (
  id TEXT PRIMARY KEY, space_id TEXT, name TEXT, data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS resource_files (
  id TEXT PRIMARY KEY, folder_id TEXT, space_id TEXT, name TEXT, size REAL, type TEXT, kind TEXT, url TEXT, by_name TEXT,
  data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0
);

-- ===== Chat =====
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY, name TEXT, space_id TEXT, client_id TEXT, permanent INTEGER DEFAULT 0,
  data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS channel_members (
  channel_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (channel_id, user_id)
);
CREATE TABLE IF NOT EXISTS channel_messages (
  id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, author_id TEXT, author_name TEXT, text TEXT NOT NULL, timestamp TEXT NOT NULL,
  reply_to TEXT
);
CREATE INDEX IF NOT EXISTS idx_chan_msgs ON channel_messages(channel_id, timestamp);
CREATE TABLE IF NOT EXISTS dm_messages (
  id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, from_name TEXT, text TEXT NOT NULL, timestamp TEXT NOT NULL, reply_to TEXT
);
CREATE INDEX IF NOT EXISTS idx_dm_from ON dm_messages(from_id, to_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_dm_to ON dm_messages(to_id, from_id, timestamp);

-- ===== Personal finance (admin only) =====
CREATE TABLE IF NOT EXISTS personal_expenses (
  id TEXT PRIMARY KEY, amount REAL, category TEXT, date TEXT, description TEXT, payment_method TEXT,
  data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS personal_income (
  id TEXT PRIMARY KEY, amount REAL, source TEXT, date TEXT, notes TEXT, data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS personal_withdrawals (
  id TEXT PRIMARY KEY, amount REAL, date TEXT, note TEXT, data TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0
);
