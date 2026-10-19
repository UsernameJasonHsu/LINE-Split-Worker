-- How an expense was entered: 'form' (LIFF form), 'sentence' (LIFF one-line input),
-- 'chat' (private chat with the bot, since removed); NULL for expenses recorded before this column.
ALTER TABLE expenses ADD COLUMN source TEXT;
