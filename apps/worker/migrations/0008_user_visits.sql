-- One row per LINE user per day (Asia/Taipei) they opened the LIFF app, for the
-- admin's per-user usage stats. Opens before this table existed are not known.
CREATE TABLE user_visits (
  line_user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  opens INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (line_user_id, day)
);

CREATE INDEX idx_user_visits_day ON user_visits (day);
