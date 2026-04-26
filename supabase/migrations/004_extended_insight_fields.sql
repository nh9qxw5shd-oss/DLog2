-- DLog2 — Extended Insight columns on the incidents table
-- The application writes a richer set of fields (CCIL type code/label, train,
-- equipment, response timings, etc.) so analysts can drill into the
-- granular CCIL classification rather than only the DLog2 umbrella category.
-- This migration ensures every column the app expects actually exists.
-- All ADDs use IF NOT EXISTS so the migration is safe to re-run.

ALTER TABLE incidents
  -- ── CCIL granular classification ──────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS incident_type_code  text,
  ADD COLUMN IF NOT EXISTS incident_type_label text,
  ADD COLUMN IF NOT EXISTS display_group       text,

  -- ── Infrastructure incident detail ────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS equipment           text,

  -- ── Identifiers / cross-references ────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS line                text,
  ADD COLUMN IF NOT EXISTS fault_number        text,
  ADD COLUMN IF NOT EXISTS possession_ref      text,
  ADD COLUMN IF NOT EXISTS btp_ref             text,
  ADD COLUMN IF NOT EXISTS third_party_ref     text,
  ADD COLUMN IF NOT EXISTS action_code         text,
  ADD COLUMN IF NOT EXISTS responder_initials  text[],

  -- ── Response timings ──────────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS advised_time        text,
  ADD COLUMN IF NOT EXISTS initial_resp_time   text,
  ADD COLUMN IF NOT EXISTS arrived_at_time     text,
  ADD COLUMN IF NOT EXISTS nwr_time            text,
  ADD COLUMN IF NOT EXISTS mins_to_advised     integer,
  ADD COLUMN IF NOT EXISTS mins_to_response    integer,
  ADD COLUMN IF NOT EXISTS mins_to_arrival     integer,
  ADD COLUMN IF NOT EXISTS incident_duration   integer,

  -- ── Train / rolling stock ─────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS train_id            text,
  ADD COLUMN IF NOT EXISTS train_company       text,
  ADD COLUMN IF NOT EXISTS train_origin        text,
  ADD COLUMN IF NOT EXISTS train_destination   text,
  ADD COLUMN IF NOT EXISTS unit_numbers        text[],

  -- ── Industry refs ─────────────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS trust_ref           text,
  ADD COLUMN IF NOT EXISTS tda_ref             text,
  ADD COLUMN IF NOT EXISTS trmc_code           text,

  -- ── Pre-computed analytics keys ───────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS fts_div_count       integer,
  ADD COLUMN IF NOT EXISTS event_count         integer,
  ADD COLUMN IF NOT EXISTS has_files           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hour_of_day         integer,
  ADD COLUMN IF NOT EXISTS day_of_week         integer;

-- Indexes that support the most common Insight cuts:
--   "all Track Circuit Failures over the last 30 days"
--   "all incidents involving asset S1543"
--   "all incidents on train 2K15"
CREATE INDEX IF NOT EXISTS idx_incidents_type_code     ON incidents (incident_type_code);
CREATE INDEX IF NOT EXISTS idx_incidents_type_label    ON incidents (incident_type_label);
CREATE INDEX IF NOT EXISTS idx_incidents_display_group ON incidents (display_group);
CREATE INDEX IF NOT EXISTS idx_incidents_equipment     ON incidents (equipment);
CREATE INDEX IF NOT EXISTS idx_incidents_train_id      ON incidents (train_id);
CREATE INDEX IF NOT EXISTS idx_incidents_hour_of_day   ON incidents (hour_of_day);
CREATE INDEX IF NOT EXISTS idx_incidents_day_of_week   ON incidents (day_of_week);

COMMENT ON COLUMN incidents.incident_type_code IS
  'CCIL numeric prefix from the type field (e.g. "07b", "05C"). '
  'Granular classification — rolls up to the category column.';

COMMENT ON COLUMN incidents.incident_type_label IS
  'CCIL type label without the numeric prefix (e.g. "Level Crossing Deliberate Misuse"). '
  'Maps 1:1 to a row in the official CCIL Incident Types settings.';

COMMENT ON COLUMN incidents.display_group IS
  'User-configured display grouping from the settings page (custom groups only). '
  'Empty when the incident sits in a built-in IncidentCategory group.';

COMMENT ON COLUMN incidents.equipment IS
  'Equipment / asset identifier captured from infrastructure incident blocks '
  '(e.g. "S1543 Points Motor", "55A-B Track Circuit"). Unique per incident.';
