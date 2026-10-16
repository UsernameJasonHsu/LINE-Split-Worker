-- User feedback (bug reports / ideas) reviewed by the app admin.
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  ledger_id TEXT,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  context_json TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  admin_note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_feedback_status ON feedback (status, created_at);

CREATE INDEX idx_feedback_user ON feedback (line_user_id, created_at);
