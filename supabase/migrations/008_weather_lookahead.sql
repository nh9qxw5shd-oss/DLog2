-- DLog2 — Persist the 5 Day Look Ahead weather statement per forecast date
--
-- NB: distinct from the existing `weather_daily` table (observed weather from
-- Open-Meteo). This table stores the OPERATIONAL weather statement entered on
-- the report's 5 Day Look Ahead — the risk classification the route was
-- actually working to.
--
-- The look-ahead in a report for log date D is forward-looking from the
-- morning D is generated (D+1), so its five columns forecast dates D+1 … D+5.
-- Each save writes one row per forecast date, and a newer report's statement
-- for the same date replaces an older one (newest-source-wins in
-- lib/supabaseClient.ts). The value that finally sticks for any date X is
-- therefore the FIRST column of the report generated the morning of X — the
-- most up-to-date statement issued before X's own log exists. Insight joins
-- this table to reports/incidents on weather_date = report_date.
--
-- Filter recipes for Insight:
--   days at a level:      WHERE overall_level = 'ADVERSE'
--   days with a risk:     WHERE 'Max Temp' = ANY (risk_types)
--   incidents on them:    JOIN incidents i ON i.report_date = weather_lookahead.weather_date

CREATE TABLE IF NOT EXISTS weather_lookahead (
  weather_date        date        PRIMARY KEY,
  source_report_date  date        NOT NULL,
  day_offset          integer     NOT NULL,  -- 1–5: which look-ahead column this came from

  -- Per-region risk maps, e.g. {"Max Temp": "ADVERSE", "Heavy Rain": "AWARE"}
  east_midlands_risks jsonb       NOT NULL DEFAULT '{}'::jsonb,
  london_north_risks  jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Derived hazard levels: GREEN | AWARE | ADVERSE | EXTREME (GREEN = normal)
  east_midlands_level text        NOT NULL DEFAULT 'GREEN',
  london_north_level  text        NOT NULL DEFAULT 'GREEN',
  overall_level       text        NOT NULL DEFAULT 'GREEN',  -- worst of both regions

  -- Union of risk names across both regions, for array filtering
  risk_types          text[]      NOT NULL DEFAULT '{}',

  -- The matching look-ahead note rows for this column
  risk_note           text,
  toc_note            text,
  foc_note            text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_weather_lookahead_overall_level ON weather_lookahead (overall_level);
CREATE INDEX IF NOT EXISTS idx_weather_lookahead_risk_types    ON weather_lookahead USING gin (risk_types);

-- The app writes with the anon key (matching the current posture of
-- reports/incidents in production). Tighten alongside those tables when the
-- project moves to authenticated access.
ALTER TABLE weather_lookahead ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open_all_weather_lookahead" ON weather_lookahead
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE weather_lookahead IS
  'Latest 5 Day Look Ahead weather statement per calendar date, written on report save. weather_date lines up with reports.report_date / incidents.report_date for weather-conditioned analytics. Not to be confused with weather_daily (observed Open-Meteo data).';
