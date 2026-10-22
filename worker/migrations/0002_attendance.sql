-- Attendance & time tracking
-- attendance_logs: one row per employee per local day (first check-in, last check-out, summed hours, status).
-- attendance_sessions: the individual check-in / check-out pairs of that day (breaks = extra sessions).
CREATE TABLE IF NOT EXISTS attendance_logs (
  id            TEXT PRIMARY KEY,
  employee_id   TEXT NOT NULL,
  date          TEXT NOT NULL,                 -- YYYY-MM-DD in the work-settings timezone
  check_in      TEXT,                          -- ISO UTC of the first check-in
  check_out     TEXT,                          -- ISO UTC of the last check-out (NULL while checked in)
  total_hours   REAL NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'Present' CHECK (status IN ('Present','Late','Half Day','Absent')),
  activity_note TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    INTEGER,
  UNIQUE (employee_id, date)
);
CREATE INDEX IF NOT EXISTS idx_att_date ON attendance_logs(date);
CREATE INDEX IF NOT EXISTS idx_att_emp ON attendance_logs(employee_id, date);

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id            TEXT PRIMARY KEY,
  attendance_id TEXT NOT NULL,
  check_in      TEXT NOT NULL,
  check_out     TEXT
);
CREATE INDEX IF NOT EXISTS idx_attsess_log ON attendance_sessions(attendance_id);

CREATE TABLE IF NOT EXISTS attendance_task_logs (
  attendance_id TEXT NOT NULL,
  task_id       TEXT NOT NULL,
  PRIMARY KEY (attendance_id, task_id)
);

CREATE TABLE IF NOT EXISTS work_settings (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  start_time     TEXT    NOT NULL DEFAULT '10:00',
  end_time       TEXT    NOT NULL DEFAULT '18:00',
  working_days   TEXT    NOT NULL DEFAULT '1,2,3,4,5',   -- 0 = Sunday … 6 = Saturday
  alert_minutes  INTEGER NOT NULL DEFAULT 60,            -- "hasn't checked in" alert after start + this
  half_day_hours REAL    NOT NULL DEFAULT 4,
  timezone       TEXT    NOT NULL DEFAULT 'Asia/Karachi',
  tracking_start TEXT    NOT NULL DEFAULT (date('now'))   -- days before this are never counted as absent
);
INSERT OR IGNORE INTO work_settings (id) VALUES (1);
