ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS events jsonb;

CREATE INDEX IF NOT EXISTS idx_incidents_events
  ON incidents USING gin (events);

COMMENT ON COLUMN incidents.events IS
  'Per-incident EVENTS block from the raw CCIL log — a JSON array of {date, time, company, description} objects in capture order.';
