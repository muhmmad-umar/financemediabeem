-- Allah's Share credit can also be adjusted straight in the database (app_settings.allah_share_credit).
-- The app remembers the value it last wrote (…_last); any difference found on load is added as a manual credit.
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('allah_share_credit', '0');
INSERT OR IGNORE INTO app_settings (key, value) SELECT 'allah_share_credit_last', value FROM app_settings WHERE key = 'allah_share_credit';
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('allah_share_credit_manual', '0');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('allah_share_credit_manual_at', '');
