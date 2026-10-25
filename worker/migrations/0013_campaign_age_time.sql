-- Campaign Builder: start time (no end date / duration any more) and age targeting mode.

ALTER TABLE campaigns ADD COLUMN start_time TEXT;                                  -- HH:MM, Pakistan time
ALTER TABLE campaigns ADD COLUMN age_mode TEXT NOT NULL DEFAULT 'CUSTOM';          -- DEFAULT (Meta optimizes) | CUSTOM (audience_age_min/max)
