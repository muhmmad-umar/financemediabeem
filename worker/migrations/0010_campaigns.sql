-- Ads Manager → Campaign Builder: AI-built Meta Ads campaign drafts.

CREATE TABLE IF NOT EXISTS campaigns (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  client_id        TEXT,
  campaign_name    TEXT NOT NULL,
  objective        TEXT,            -- CONVERSIONS | TRAFFIC | ENGAGEMENT | LEAD_GENERATION | AWARENESS
  budget_daily     REAL,            -- PKR
  duration_days    INTEGER,
  start_date       TEXT,
  audience_age_min INTEGER,
  audience_age_max INTEGER,
  audience_gender  TEXT,            -- ALL | MALE | FEMALE
  audience_locations  TEXT,         -- JSON array
  audience_interests  TEXT,         -- JSON array
  audience_behaviors  TEXT,         -- JSON array
  ad_headline      TEXT,
  ad_primary_text  TEXT,
  ad_description   TEXT,
  ad_format        TEXT,            -- SINGLE_IMAGE | VIDEO | CAROUSEL | REELS
  placements       TEXT,            -- JSON array
  language         TEXT,            -- ENGLISH | URDU | HINGLISH
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','launched')),
  voice_input      TEXT,            -- the original spoken instruction (transcript)
  text_input       TEXT,            -- the original typed instruction
  summary          TEXT,
  suggestions      TEXT,            -- JSON array
  instructions_json TEXT,           -- every instruction given, in order (original + follow-ups)
  launched_at      TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_campaigns_user   ON campaigns(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_campaigns_client ON campaigns(client_id, updated_at);

-- light per-user rate limiting for AI calls that don't create a history row
CREATE TABLE IF NOT EXISTS ai_usage (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_usage ON ai_usage(user_id, kind, created_at);
