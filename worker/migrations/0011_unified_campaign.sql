-- Unified Ads Manager flow: one brief → campaign settings + 3 ad copy variations (one is selected).

ALTER TABLE campaigns ADD COLUMN selected_copy_index INTEGER;   -- 0-2, NULL until a variation is chosen
ALTER TABLE campaigns ADD COLUMN ad_copies_json TEXT;           -- all 3 variations [{angle, headline, primary_text, description}]
ALTER TABLE campaigns ADD COLUMN product_url TEXT;
ALTER TABLE campaigns ADD COLUMN brief TEXT;                    -- the short description from step 1
ALTER TABLE campaigns ADD COLUMN ad_style TEXT;                 -- market | premium
ALTER TABLE campaigns ADD COLUMN generation_id TEXT;            -- ad_generations row the copies came from

-- Ad Library: every ad copy variation from a saved campaign (plus copies saved in the old Ad Copy Studio)
CREATE TABLE IF NOT EXISTS ad_library (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  client_id     TEXT,
  campaign_id   TEXT,
  campaign_name TEXT,
  angle         TEXT,
  headline      TEXT,
  primary_text  TEXT,
  description   TEXT,
  language      TEXT,
  style         TEXT,
  selected      INTEGER NOT NULL DEFAULT 0,
  source        TEXT NOT NULL DEFAULT 'campaign',   -- 'campaign' | 'legacy'
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ad_lib_user     ON ad_library(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ad_lib_campaign ON ad_library(campaign_id);

-- bring over copies the team starred in the old Ad Copy Studio
INSERT INTO ad_library (id, user_id, client_id, campaign_id, campaign_name, angle, headline, primary_text, description, language, style, selected, source, created_at)
SELECT id, user_id, client_id, NULL, NULL, 'Saved copy',
       CASE type WHEN 'headline' THEN content END, CASE type WHEN 'primary_text' THEN content END, CASE type WHEN 'description' THEN content END,
       upper(language), style, 0, 'legacy', created_at
FROM ad_copies WHERE saved = 1;
