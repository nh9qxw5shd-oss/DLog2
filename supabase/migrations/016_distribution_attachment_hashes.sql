-- DLog2 — fingerprints of the files a send carried, so a send that stopped
-- part-way can only be resumed with exactly the same attachments (everyone on
-- the list receives the same documents). One "kind:sha256" entry per file.

ALTER TABLE dlog2_distribution_sends
  ADD COLUMN IF NOT EXISTS attachment_hashes text[] NOT NULL DEFAULT '{}';
