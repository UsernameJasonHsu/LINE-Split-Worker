-- Self-provided payment details (bank account, LINE Pay, etc.), per LINE user.
-- Shown to members of ledgers the user belongs to.
CREATE TABLE payment_profiles (
  line_user_id TEXT PRIMARY KEY,
  info TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
