-- Set when the member leaves the ledger's LINE group: they lose access to the
-- ledger (and everyone's payment info) but stay in its history and balances.
-- Cleared when they are seen in the group again.
ALTER TABLE members ADD COLUMN left_at INTEGER;
