-- Employee workspace: link an "active task" to the attendance record + deletion tombstones so the admin app
-- can drop tasks an employee deleted.
ALTER TABLE attendance_logs ADD COLUMN active_task_id TEXT;

CREATE TABLE IF NOT EXISTS tombstones (
  key TEXT NOT NULL,          -- collection name used by the admin app (cu_tasks, cu_subtasks, cu_comments, cu_time_logs)
  id  TEXT NOT NULL,
  ts  INTEGER NOT NULL,
  PRIMARY KEY (key, id)
);
CREATE INDEX IF NOT EXISTS idx_tomb_ts ON tombstones(ts);
