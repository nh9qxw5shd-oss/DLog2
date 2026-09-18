-- DLog2 — Network Rail Route 7 Day Forecast (7 days x 4 areas)
--
-- Network Rail moved the route weather forecast from a 5 day / two-region
-- statement to a 7 day forecast split into four areas: Lincolnshire, East
-- Midlands North, East Midlands South and London - Luton. DLog2 now ingests the
-- forecast PDF (MetDesk "East Midlands Route 7 Day Forecast") next to the CCIL
-- export and writes the result here. The 09:00 route call (0815) and the 05:30
-- message (Messaging-Assistant) read the latest issue from these tables
-- instead of re-keying it.
--
--   weather_forecasts       one row per issued PDF (unique on issued_at)
--   weather_forecast_days   one row per (issue, area, date) — the hazard table
--   weather_forecast_latest / weather_forecast_latest_days
--                           convenience views: the newest issue only
--   weather_lookahead       extended with the four areas and temperatures;
--                           the legacy two-region columns stay populated so
--                           existing Insight queries keep working
--                           (east_midlands = worst of the three East Midlands
--                           areas, london_north = London - Luton).

-- ─── Forecast issues ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS weather_forecasts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  issued_at         timestamptz NOT NULL UNIQUE,
  issued_by         text,
  title             text,
  route             text,
  valid_from        timestamptz,
  valid_to          timestamptz,
  valid_from_date   date        NOT NULL,   -- date of the first forecast row
  summary_24h       text,                   -- "Forecast - 24 hours (weather and hazard summary)"
  summary_2_7       text,                   -- "Forecast - 2 to 7 Days (weather and hazard summary)"
  forecaster_phone  text,
  source_filename   text,
  source_hash       text,                   -- sha256 of the PDF bytes
  warnings          text[]      NOT NULL DEFAULT '{}',
  document          jsonb       NOT NULL,   -- the full parsed ForecastDocument
  imported_by       text,
  imported_from     text        NOT NULL DEFAULT 'dlog2',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_weather_forecasts_valid_from_date ON weather_forecasts (valid_from_date DESC);

COMMENT ON TABLE weather_forecasts IS
  'One row per issued Network Rail Route 7 Day Forecast PDF, parsed by DLog2. Newest issued_at is the current forecast. Read by the 09:00 route call and the 05:30 message.';

-- ─── Per area / per day hazard rows ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS weather_forecast_days (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_id             uuid        NOT NULL REFERENCES weather_forecasts(id) ON DELETE CASCADE,
  issued_at               timestamptz NOT NULL,           -- denormalised for "latest" queries
  area_key                text        NOT NULL,           -- lincolnshire | em_north | em_south | london_luton
  area_name               text        NOT NULL,           -- as printed, e.g. "East Mids North"
  day_index               integer     NOT NULL,           -- 0..6, 0 = first row (the forecast's "today")
  forecast_date           date        NOT NULL,
  day_name                text,
  overall_level           text        NOT NULL DEFAULT 'GREEN',  -- worst cell: GREEN | AWARE | ADVERSE | EXTREME
  risks                   jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- non-normal only, e.g. {"Max Temp":"AWARE"}
  risk_types              text[]      NOT NULL DEFAULT '{}',
  hazards                 jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- every cell with level + confidence
  min_temp_morning        numeric(4,1),                   -- Min Temp Morn (06-11)
  max_temp                numeric(4,1),                   -- Max Temp (06-18)
  min_temp_night          numeric(4,1),                   -- Min Temp (18-06)
  min_temp_morning_level  text,
  max_temp_level          text,
  min_temp_night_level    text,
  ice_day                 boolean,
  ice_day_confidence      text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (forecast_id, area_key, forecast_date)
);

CREATE INDEX IF NOT EXISTS idx_weather_forecast_days_date   ON weather_forecast_days (forecast_date, area_key);
CREATE INDEX IF NOT EXISTS idx_weather_forecast_days_issued ON weather_forecast_days (issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_weather_forecast_days_risks  ON weather_forecast_days USING gin (risk_types);

COMMENT ON TABLE weather_forecast_days IS
  'Hazard table rows of each Route 7 Day Forecast issue: one row per area per day. Join weather_forecasts for the narrative summaries.';

-- ─── Latest issue views ──────────────────────────────────────────────────────

CREATE OR REPLACE VIEW weather_forecast_latest WITH (security_invoker = on) AS
  SELECT * FROM weather_forecasts ORDER BY issued_at DESC LIMIT 1;

CREATE OR REPLACE VIEW weather_forecast_latest_days WITH (security_invoker = on) AS
  SELECT d.*
  FROM weather_forecast_days d
  JOIN weather_forecast_latest f ON f.id = d.forecast_id
  ORDER BY d.area_key, d.day_index;

-- ─── Look-ahead: four areas, seven days ──────────────────────────────────────

ALTER TABLE weather_lookahead
  ADD COLUMN IF NOT EXISTS area_risks   jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"lincolnshire": {"Max Temp":"AWARE"}, "em_north": {...}, ...}
  ADD COLUMN IF NOT EXISTS area_levels  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"lincolnshire": "AWARE", ...}
  ADD COLUMN IF NOT EXISTS temps        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"lincolnshire": {"minMorning":10.5,"max":21,"minNight":14.5}, ...}
  ADD COLUMN IF NOT EXISTS forecast_id  uuid REFERENCES weather_forecasts(id) ON DELETE SET NULL;

COMMENT ON COLUMN weather_lookahead.day_offset IS '1–7: which look-ahead column this came from (was 1–5 before the 7 day forecast).';
COMMENT ON COLUMN weather_lookahead.east_midlands_risks IS 'Legacy: worst level per risk across lincolnshire, em_north and em_south (see area_risks).';
COMMENT ON COLUMN weather_lookahead.london_north_risks IS 'Legacy: the london_luton area (see area_risks).';
COMMENT ON TABLE weather_lookahead IS
  'Latest 7 Day Look Ahead weather statement per calendar date, written on report save. weather_date lines up with reports.report_date / incidents.report_date for weather-conditioned analytics. Four areas in area_risks/area_levels; the two legacy region columns are derived from them. Not to be confused with weather_daily (observed Open-Meteo data).';

-- ─── Access ──────────────────────────────────────────────────────────────────
-- Same posture as weather_lookahead: the apps write with the anon key today.
-- Tighten alongside reports/incidents when the project moves to authenticated
-- access.

ALTER TABLE weather_forecasts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_forecast_days  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "open_all_weather_forecasts" ON weather_forecasts;
CREATE POLICY "open_all_weather_forecasts" ON weather_forecasts
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "open_all_weather_forecast_days" ON weather_forecast_days;
CREATE POLICY "open_all_weather_forecast_days" ON weather_forecast_days
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
