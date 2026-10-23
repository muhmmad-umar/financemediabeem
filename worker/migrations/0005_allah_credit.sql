-- Allah's Share overpayment credit.
--   • a Voluntary payment first settles the remaining obligation, any excess becomes CREDIT (credit_added)
--   • when new income raises the obligation the credit is used automatically; every use is recorded as a
--     'credit_applied' row (kind) carrying credit_applied = how much credit was used
--   • the running balance is stored as app_settings key 'allah_share_credit'
ALTER TABLE allah_share_payments ADD COLUMN kind TEXT NOT NULL DEFAULT 'payment';     -- 'payment' | 'credit_applied'
ALTER TABLE allah_share_payments ADD COLUMN obligated_part REAL;                      -- voluntary: part applied to the obligation
ALTER TABLE allah_share_payments ADD COLUMN credit_added REAL NOT NULL DEFAULT 0;     -- voluntary: excess that became credit
ALTER TABLE allah_share_payments ADD COLUMN credit_applied REAL NOT NULL DEFAULT 0;   -- credit used (credit_applied rows)
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('allah_share_credit', '0');
