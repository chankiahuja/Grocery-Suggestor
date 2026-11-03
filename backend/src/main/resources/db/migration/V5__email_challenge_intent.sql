ALTER TABLE email_challenges ADD COLUMN intent VARCHAR(6) NOT NULL DEFAULT 'login';

-- Preserve pending signup challenges from before intent was stored explicitly.
UPDATE email_challenges SET intent='signup' WHERE display_name IS NOT NULL;
