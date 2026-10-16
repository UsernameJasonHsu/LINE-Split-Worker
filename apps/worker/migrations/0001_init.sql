CREATE TABLE ledgers (
  id TEXT PRIMARY KEY,
  line_group_id TEXT UNIQUE,
  name TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'TWD',
  created_at INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  line_user_id TEXT,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  is_virtual INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL,
  UNIQUE (ledger_id, line_user_id)
);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  title TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  fx_rate TEXT NOT NULL,
  fx_source TEXT NOT NULL,
  base_amount_minor INTEGER NOT NULL,
  split_type TEXT NOT NULL,
  category TEXT,
  spent_at INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revision TEXT NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX idx_expenses_ledger ON expenses (ledger_id, deleted_at, spent_at);

CREATE TABLE expense_payers (
  expense_id TEXT NOT NULL REFERENCES expenses(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  amount_minor INTEGER NOT NULL,
  base_amount_minor INTEGER NOT NULL,
  PRIMARY KEY (expense_id, member_id)
);

CREATE TABLE expense_shares (
  expense_id TEXT NOT NULL REFERENCES expenses(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  split_value INTEGER,
  share_minor INTEGER NOT NULL,
  base_share_minor INTEGER NOT NULL,
  PRIMARY KEY (expense_id, member_id)
);

CREATE TABLE settlements (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  from_member TEXT NOT NULL REFERENCES members(id),
  to_member TEXT NOT NULL REFERENCES members(id),
  amount_minor INTEGER NOT NULL,
  settled_at INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX idx_settlements_ledger ON settlements (ledger_id, deleted_at);

CREATE TABLE fx_rates (
  date TEXT NOT NULL,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  rate TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (date, from_currency, to_currency)
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id TEXT NOT NULL,
  actor_member_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  at INTEGER NOT NULL
);

CREATE INDEX idx_audit_logs_ledger ON audit_logs (ledger_id, at);
