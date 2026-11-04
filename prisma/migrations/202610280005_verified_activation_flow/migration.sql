ALTER TABLE "user" ADD COLUMN pending_onboarding jsonb;

CREATE TABLE activation_confirmation_emails (
  user_id text PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('sending', 'sent', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

REVOKE ALL ON activation_confirmation_emails FROM PUBLIC;
REVOKE ALL ON activation_confirmation_emails FROM mybusiness_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON activation_confirmation_emails TO mybusiness_app;
