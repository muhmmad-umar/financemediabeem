-- Ad Copy Studio: generations, individual copies, learned preferences and AI settings.

CREATE TABLE IF NOT EXISTS ad_generations (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  client_id   TEXT,
  product_url TEXT,
  page_title  TEXT,
  brief       TEXT,
  language    TEXT,
  style       TEXT,
  results_json TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ad_gen_user ON ad_generations(user_id, created_at);

CREATE TABLE IF NOT EXISTS ad_copies (
  id            TEXT PRIMARY KEY,
  generation_id TEXT NOT NULL REFERENCES ad_generations(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  client_id     TEXT,
  type          TEXT NOT NULL CHECK (type IN ('headline','primary_text','description')),
  content       TEXT NOT NULL,
  language      TEXT,
  style         TEXT,
  position      INTEGER NOT NULL DEFAULT 0,
  saved         INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ad_copies_gen ON ad_copies(generation_id);
CREATE INDEX IF NOT EXISTS idx_ad_copies_saved ON ad_copies(user_id, saved);

CREATE TABLE IF NOT EXISTS ad_preferences (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  copy_id    TEXT NOT NULL,
  type       TEXT NOT NULL,
  content    TEXT NOT NULL,
  preference TEXT NOT NULL CHECK (preference IN ('approved','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_pref_user_copy ON ad_preferences(user_id, copy_id);
CREATE INDEX IF NOT EXISTS idx_ad_pref_user ON ad_preferences(user_id, created_at);

CREATE TABLE IF NOT EXISTS ai_settings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_key   TEXT NOT NULL UNIQUE,
  setting_value TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
