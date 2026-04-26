-- EMCC DLog2 — Cross-log CCIL continuation tracking
-- Adds two columns to incidents so a CCIL reference that spans multiple log
-- generations is counted only once and its delay is tracked as a delta rather
-- than re-accumulated in full.

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS is_continuation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delay_delta     integer;

-- Index helps the cross-date lookup performed before each insert
CREATE INDEX IF NOT EXISTS idx_incidents_ccil ON incidents (ccil);

COMMENT ON COLUMN incidents.is_continuation IS
  'True when this CCIL reference already appeared in an earlier report. '
  'Continuations are excluded from event-type tallies.';

COMMENT ON COLUMN incidents.delay_delta IS
  'For continuations: additional delay minutes since the previous occurrence '
  '(clamped to 0; NULL for first-seen incidents).';
