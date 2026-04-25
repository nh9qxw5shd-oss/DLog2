-- EMCC DLog2 — Incident storage for historical trend charts
-- Run this in your Supabase SQL editor (or via supabase db push).

-- ── Reports ──────────────────────────────────────────────────────────────────
-- One row per generated report. report_date is the de-duplication key:
-- re-generating a report for the same date upserts this row in place.

CREATE TABLE IF NOT EXISTS reports (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date          date        NOT NULL UNIQUE,
  period               text,
  control_centre       text,
  created_by           text,
  season_mode          text,
  total_delay          integer     NOT NULL DEFAULT 0,
  total_cancelled      integer     NOT NULL DEFAULT 0,
  total_part_cancelled integer     NOT NULL DEFAULT 0,
  incident_count       integer     NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ── Incidents ─────────────────────────────────────────────────────────────────
-- One row per incident, linked to its parent report.
-- Existing rows are deleted and re-inserted when a report is re-generated
-- (via upsertReportData in lib/supabaseClient.ts).

CREATE TABLE IF NOT EXISTS incidents (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id      uuid        NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  report_date    date        NOT NULL,
  ccil           text,
  category       text        NOT NULL,
  severity       text        NOT NULL,
  title          text,
  location       text,
  area           text,
  incident_start text,
  minutes_delay  integer     NOT NULL DEFAULT 0,
  trains_delayed integer     NOT NULL DEFAULT 0,
  cancelled      integer     NOT NULL DEFAULT 0,
  part_cancelled integer     NOT NULL DEFAULT 0,
  is_highlight   boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes for trend queries ─────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_incidents_report_date ON incidents (report_date);
CREATE INDEX IF NOT EXISTS idx_incidents_category    ON incidents (category);
CREATE INDEX IF NOT EXISTS idx_incidents_report_id   ON incidents (report_id);

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Enable RLS and restrict to authenticated users only.
-- Adjust policies to suit your auth setup (e.g. magic-link or SSO).

ALTER TABLE reports   ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read and write all rows
CREATE POLICY "auth_all_reports"   ON reports   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_incidents" ON incidents FOR ALL TO authenticated USING (true) WITH CHECK (true);
