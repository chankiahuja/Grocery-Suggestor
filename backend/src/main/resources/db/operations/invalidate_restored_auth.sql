-- Operator-only restore step. Stop ALL application instances and mail workers
-- and verify the restored database/schema before executing this script.
-- This is not a Flyway migration and must not run on normal startup.
BEGIN;
DELETE FROM spring_session;
-- spring_session_attributes are removed by the existing ON DELETE CASCADE.
DELETE FROM email_challenges;
COMMIT;
