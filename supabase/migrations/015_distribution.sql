-- DLog2 — daily log distribution by email (Resend).
--
-- The distribution list holds people's names and work addresses, so both
-- tables are server-side only: RLS is enabled with NO policies, and only the
-- service-role key (the /api/distribution routes) can read or write them.
-- Never add an anon policy here.

CREATE TABLE IF NOT EXISTS dlog2_distribution_recipients (
  id          bigserial   PRIMARY KEY,
  email       text        NOT NULL,
  name        text,
  active      boolean     NOT NULL DEFAULT true,
  added_at    timestamptz NOT NULL DEFAULT now(),
  added_by    text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- One row per address, whatever its case.
CREATE UNIQUE INDEX IF NOT EXISTS dlog2_distribution_recipients_email_key
  ON dlog2_distribution_recipients (lower(email));

-- One row per send (live or test). sent_to grows batch by batch, so a send
-- that fails part-way can be resumed to the addresses not yet reached.
CREATE TABLE IF NOT EXISTS dlog2_distribution_sends (
  id              bigserial   PRIMARY KEY,
  log_date        date        NOT NULL,
  is_test         boolean     NOT NULL DEFAULT false,
  status          text        NOT NULL DEFAULT 'sending',   -- sending | sent | partial | failed
  sent_by         text,
  subject         text        NOT NULL,
  to_address      text,
  attachments     text[]      NOT NULL DEFAULT '{}',
  recipient_count integer     NOT NULL DEFAULT 0,           -- addresses intended
  sent_to         text[]      NOT NULL DEFAULT '{}',        -- addresses Resend accepted
  resend_ids      text[]      NOT NULL DEFAULT '{}',
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);
CREATE INDEX IF NOT EXISTS dlog2_distribution_sends_date
  ON dlog2_distribution_sends (log_date DESC, created_at DESC);

ALTER TABLE dlog2_distribution_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE dlog2_distribution_sends      ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: service role only.

COMMENT ON TABLE dlog2_distribution_recipients IS 'DLog2 daily log distribution list (BCC). Service-role only (RLS with no policies).';
COMMENT ON TABLE dlog2_distribution_sends IS 'DLog2 daily log sends through Resend, per log date, with the addresses reached. Service-role only.';
