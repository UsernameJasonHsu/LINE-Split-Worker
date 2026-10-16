-- For "fixed_rest" splits: whether the member also takes part in splitting the
-- remainder equally (split_value holds their fixed amount, if any). NULL for
-- other split types.
ALTER TABLE expense_shares ADD COLUMN in_rest INTEGER;
