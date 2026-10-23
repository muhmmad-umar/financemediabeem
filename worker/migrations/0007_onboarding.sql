-- Employee onboarding: secure one-time links, submitted forms and the editable agreement template.

CREATE TABLE IF NOT EXISTS agreement_template (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  content       TEXT NOT NULL,
  probation_days INTEGER NOT NULL DEFAULT 90,
  version       INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A link is bound to the template version that was current when it was generated, so a later
-- template edit never changes what an employee with an open link is asked to sign.
CREATE TABLE IF NOT EXISTS onboarding_tokens (
  id             TEXT PRIMARY KEY,
  employee_id    TEXT NOT NULL,
  token          TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','revoked')),
  expires_at     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  designation    TEXT,
  salary         REAL,
  start_date     TEXT,
  agreement_content TEXT,
  agreement_version INTEGER,
  probation_days INTEGER
);
CREATE INDEX IF NOT EXISTS idx_onb_tokens_emp ON onboarding_tokens(employee_id);

CREATE TABLE IF NOT EXISTS onboarding_submissions (
  id                TEXT PRIMARY KEY,
  token_id          TEXT NOT NULL UNIQUE REFERENCES onboarding_tokens(id),
  full_name         TEXT, dob TEXT, gender TEXT, phone TEXT, email TEXT, address TEXT, cnic TEXT,
  emergency_name    TEXT, emergency_phone TEXT, emergency_relation TEXT,
  bank_name         TEXT, account_title TEXT, account_number TEXT, iban TEXT, payment_method TEXT,
  signature_data    TEXT,
  agreement_version INTEGER,
  agreement_text    TEXT,            -- the agreement exactly as rendered and signed
  designation       TEXT, salary REAL, start_date TEXT,
  photo             TEXT,
  submitted_at      TEXT NOT NULL DEFAULT (datetime('now')),
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  rejection_reason  TEXT,
  reviewed_at       TEXT,
  employee_id       TEXT
);
CREATE INDEX IF NOT EXISTS idx_onb_sub_status ON onboarding_submissions(status);
