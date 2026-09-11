-- DLog2 — Daily ESR (Emergency Speed Restriction) snapshots from NRSDB
--
-- Populated by the log build stage (POST /api/esr/snapshot). Each time a log
-- is generated the route's currently imposed ESRs are pulled from NRSDB and
-- written here as a dated snapshot, then diffed against the most recent PRIOR
-- snapshot date to classify each restriction as NEW / AMENDED / UNCHANGED and
-- to list any REMOVED since that baseline. The PDF renders the result; the
-- tables keep it for comparison on subsequent days and for use elsewhere
-- (Insight, the 05:30 messaging assistant, ad-hoc queries).
--
-- Identity across revisions: NRSDB numbers an ESR as e.g. "EM 061C.26" where
-- "EM 061.26" is the stable base_ref and the trailing letter is the revision
-- (none = original, A, B, C …). Snapshots are keyed on base_ref so an
-- amendment shows as a change to one restriction, not a removal + addition.
--
-- Day boundary is Europe/London calendar date of capture. Re-running the log
-- build on the same day overwrites that day's snapshot with the latest pull.

-- ── One row per ESR per snapshot date ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS esr_snapshots (
  snapshot_date    date        NOT NULL,
  route_code       text        NOT NULL DEFAULT 'EM',
  base_ref         text        NOT NULL,   -- e.g. "EM 061.26" (stable across revisions)
  refnum           text        NOT NULL,   -- e.g. "EM 061C.26" (as shown in NRSDB)
  revision_letter  text        NOT NULL DEFAULT '',
  revision_rank    integer     NOT NULL DEFAULT 0,  -- 0 = original, 1 = A, 2 = B …
  nrsdb_id         bigint,

  speed_value      text,
  speed_unit       text,
  linespeed        text,
  du_name          text,
  elr_code         text,
  elr_description  text,
  lor_code         text,
  lor_description  text,
  location         text,
  reason           text,
  lines            jsonb,                  -- NRSDB "lines" structure kept verbatim
  lines_text       text,                   -- flattened, human-readable line list

  -- Timestamps as NRSDB supplied them (text, never lossy) plus a parsed
  -- timestamptz when the value was unambiguous. Query on the parsed column;
  -- fall back to the raw one if it is NULL.
  when_imposed_raw text,
  when_imposed     timestamptz,
  etr_raw          text,
  etr              timestamptz,

  fms_number       text,
  ccil_number      text,
  tsr_reference    text,

  captured_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_date, route_code, base_ref)
);

CREATE INDEX IF NOT EXISTS idx_esr_snapshots_date     ON esr_snapshots (snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_esr_snapshots_base_ref ON esr_snapshots (base_ref);
CREATE INDEX IF NOT EXISTS idx_esr_snapshots_ccil     ON esr_snapshots (ccil_number);

-- ── One row per snapshot run (date × route): counts + the computed diff ──────

CREATE TABLE IF NOT EXISTS esr_snapshot_runs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date   date        NOT NULL,
  route_code      text        NOT NULL DEFAULT 'EM',
  report_date     date,                     -- DLog2 log date the build was for
  captured_at     timestamptz NOT NULL DEFAULT now(),
  esr_count       integer     NOT NULL DEFAULT 0,
  baseline_date   date,                     -- prior snapshot diffed against (NULL on first run)
  new_count       integer     NOT NULL DEFAULT 0,
  amended_count   integer     NOT NULL DEFAULT 0,
  removed_count   integer     NOT NULL DEFAULT 0,
  unchanged_count integer     NOT NULL DEFAULT 0,
  -- {new: [...], amended: [{..., changes: [{field, old, new}]}], removed: [...]}
  -- Full row detail per entry so downstream consumers need not re-join.
  diff            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Verbatim NRSDB payload for the run, for reprocessing if the flattening
  -- ever needs to change.
  raw             jsonb,
  UNIQUE (snapshot_date, route_code)
);

CREATE INDEX IF NOT EXISTS idx_esr_snapshot_runs_report_date ON esr_snapshot_runs (report_date);

-- ── Convenience view: the latest snapshot per route ("what is live now") ─────

CREATE OR REPLACE VIEW esr_current AS
  SELECT s.*
  FROM esr_snapshots s
  WHERE s.snapshot_date = (
    SELECT max(snapshot_date) FROM esr_snapshots x WHERE x.route_code = s.route_code
  );

-- ── Row Level Security ───────────────────────────────────────────────────────
-- The API route writes with SUPABASE_SERVICE_ROLE_KEY when set (bypasses
-- RLS); without it, it falls back to the public anon key, which these policies
-- permit to match the current posture of reports/incidents/weather_lookahead.
-- Tighten alongside those tables when the project moves to authenticated
-- access.

ALTER TABLE esr_snapshots     ENABLE ROW LEVEL SECURITY;
ALTER TABLE esr_snapshot_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open_all_esr_snapshots" ON esr_snapshots
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open_all_esr_snapshot_runs" ON esr_snapshot_runs
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE esr_snapshots IS
  'Daily snapshot of imposed ESRs per route, pulled from NRSDB at log build time. Keyed on (snapshot_date, route_code, base_ref); base_ref is the ESR number without its revision letter.';
COMMENT ON TABLE esr_snapshot_runs IS
  'One row per ESR snapshot run: counts, the prior baseline date it was diffed against, and the full new/amended/removed diff as JSON.';
COMMENT ON VIEW esr_current IS
  'Rows of the most recent esr_snapshots date per route — the live imposed ESR list as last captured.';
