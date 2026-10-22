-- One row per time someone opened the new-expense form: whether they saved or
-- left, how (form / one-line sentence), and how long and how many taps it took.
-- Shows on the admin page whether changes to the form make recording faster.
CREATE TABLE entry_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id TEXT NOT NULL,
  line_user_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  source TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  taps INTEGER NOT NULL,
  at INTEGER NOT NULL
);

CREATE INDEX idx_entry_sessions_at ON entry_sessions (at);
