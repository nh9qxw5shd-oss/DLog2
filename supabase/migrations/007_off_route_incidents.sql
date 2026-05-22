-- DLog2 — Off-route incident flag
-- Incidents from outside the East Midlands managed route are sometimes included
-- in the CCIL log for visibility (loop-in due to performance impact). This flag
-- marks them as off-route so their delay minutes are excluded from EM route
-- totals while still appearing in the log for context.

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS is_off_route boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_incidents_is_off_route ON incidents (is_off_route)
  WHERE is_off_route = true;

COMMENT ON COLUMN incidents.is_off_route IS
  'True when the incident lies outside the East Midlands managed route. '
  'Included in the log for visibility only — excluded from route delay and '
  'cancellation totals. Marked [Off Route] in the generated PDF.';
