-- Real-time messaging (Durable Objects): edit / delete / seen state, reactions, presence, unread tracking.
ALTER TABLE channel_messages ADD COLUMN edited_at TEXT;
ALTER TABLE channel_messages ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dm_messages ADD COLUMN edited_at TEXT;
ALTER TABLE dm_messages ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dm_messages ADD COLUMN seen_at TEXT;               -- set when the recipient has the conversation open (✓✓)
ALTER TABLE task_comments ADD COLUMN edited_at TEXT;
ALTER TABLE task_comments ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS message_reactions (
  id           TEXT PRIMARY KEY,
  message_id   TEXT NOT NULL,
  message_type TEXT NOT NULL CHECK (message_type IN ('channel','dm','task')),
  user_id      TEXT NOT NULL,
  emoji        TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (message_type, message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_react_msg ON message_reactions(message_type, message_id);

CREATE TABLE IF NOT EXISTS user_presence (
  user_id   TEXT PRIMARY KEY,
  status    TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online','away','offline')),
  last_seen TEXT
);

-- last time each user looked at a room, for the unread badges
CREATE TABLE IF NOT EXISTS chat_reads (
  user_id   TEXT NOT NULL,
  room      TEXT NOT NULL,            -- channel:<id> | dm:<a>:<b> | task:<id>
  last_read TEXT NOT NULL,
  PRIMARY KEY (user_id, room)
);
