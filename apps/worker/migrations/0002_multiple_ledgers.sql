-- A group can now have many ledgers over time, with at most one open.
-- SQLite cannot drop the old UNIQUE(line_group_id), so the table is rebuilt.
-- Foreign keys from other tables are checked at commit, after the rename.
PRAGMA defer_foreign_keys = on;

CREATE TABLE ledgers_new (
  id TEXT PRIMARY KEY,
  line_group_id TEXT,
  name TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'TWD',
  created_at INTEGER NOT NULL,
  archived_at INTEGER,
  closed_at INTEGER,
  successor_id TEXT
);

INSERT INTO ledgers_new (id, line_group_id, name, base_currency, created_at, archived_at)
SELECT id, line_group_id, name, base_currency, created_at, archived_at FROM ledgers;

DROP TABLE ledgers;

ALTER TABLE ledgers_new RENAME TO ledgers;

CREATE UNIQUE INDEX ux_ledgers_open_per_group ON ledgers (line_group_id) WHERE closed_at IS NULL;

CREATE INDEX idx_ledgers_group ON ledgers (line_group_id, created_at);

PRAGMA defer_foreign_keys = off;
