-- Spring Session principals are strings, while account IDs are numeric.
-- Keep an indexed string reference so the database can reject an in-flight
-- request attempting to save an authenticated session after account deletion.
ALTER TABLE accounts ADD COLUMN session_principal VARCHAR(100);
UPDATE accounts SET session_principal = CAST(id AS VARCHAR(100));
ALTER TABLE accounts ADD CONSTRAINT uq_account_session_principal UNIQUE (session_principal);

-- Invalid legacy principals have no valid account; do not retain usable state.
DELETE FROM spring_session WHERE principal_name IS NOT NULL
 AND principal_name NOT IN (SELECT session_principal FROM accounts WHERE session_principal IS NOT NULL);
ALTER TABLE spring_session ADD CONSTRAINT fk_session_account
 FOREIGN KEY (principal_name) REFERENCES accounts(session_principal) ON DELETE CASCADE;
