-- DLog2 — keep NRSDB's own record timestamp on each ESR snapshot row.
-- The real feed carries "updated_at" per ESR (when the record was last
-- edited in NRSDB). Stored for analysis; not itself an amendment trigger.

ALTER TABLE esr_snapshots
  ADD COLUMN IF NOT EXISTS updated_at_raw   text,
  ADD COLUMN IF NOT EXISTS nrsdb_updated_at timestamptz;

CREATE OR REPLACE VIEW esr_current AS
  SELECT s.*
  FROM esr_snapshots s
  WHERE s.snapshot_date = (
    SELECT max(snapshot_date) FROM esr_snapshots x WHERE x.route_code = s.route_code
  );
