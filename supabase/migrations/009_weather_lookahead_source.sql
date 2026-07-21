-- DLog2 — Track where each weather_lookahead statement came from
--
-- 'report'   — written by the app when a daily report is saved (the default)
-- 'whatsapp' — backfilled from the EM State of the Route WhatsApp history,
--              whose ~05:30 daily message states the day's weather rating and
--              risks. Backfilled rows are day-of statements: day_offset is 0
--              and source_report_date equals weather_date, so the app's
--              newest-source-wins guard (>= on source_report_date) lets a
--              same-day statement stand against the previous day's look-ahead.

ALTER TABLE weather_lookahead
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'report';

COMMENT ON COLUMN weather_lookahead.source IS
  'Provenance: ''report'' = saved from a daily report''s 5 Day Look Ahead; ''whatsapp'' = backfilled from the EM State of the Route morning message (day_offset 0, day-of statement).';
