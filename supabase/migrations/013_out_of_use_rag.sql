-- DLog2 — Out of Use register: unified infrastructure section + ops RAG
--
-- Feedback from maintenance: the short-term / long-term split added nothing,
-- and the register needed a place for ops to say what an out-of-use asset
-- means for the train service. This migration:
--
--   1. Adds `rag` (RED significant / AMBER minimal / GREEN no impact expected)
--      and `ops_impact` (free text). Both are ops' to fill in; a NULL rag
--      means "not yet assessed" and sorts above GREEN so it gets looked at.
--   2. Folds the old `restriction` column into `detail`, which now carries
--      maintenance's single "issue and restrictions imposed" narrative.
--   3. Collapses SHORT_TERM and LONG_TERM into one section, INFRA. UPS is
--      unchanged.
--
-- Run once, after 012. Safe to re-run: every step is guarded.

ALTER TABLE out_of_use_register
  ADD COLUMN IF NOT EXISTS rag        text CHECK (rag IN ('RED', 'AMBER', 'GREEN')),
  ADD COLUMN IF NOT EXISTS ops_impact text NOT NULL DEFAULT '';

-- Merge restriction into detail (restriction first — it was the headline), then drop it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'out_of_use_register' AND column_name = 'restriction') THEN
    UPDATE out_of_use_register
       SET detail = concat_ws(E'\n', nullif(trim(restriction), ''), nullif(trim(detail), ''))
     WHERE section IN ('SHORT_TERM', 'LONG_TERM', 'INFRA');
    ALTER TABLE out_of_use_register DROP COLUMN restriction;
  END IF;
END $$;

-- One infrastructure section.
ALTER TABLE out_of_use_register DROP CONSTRAINT IF EXISTS out_of_use_register_section_check;
UPDATE out_of_use_register SET section = 'INFRA' WHERE section IN ('SHORT_TERM', 'LONG_TERM');
ALTER TABLE out_of_use_register
  ADD CONSTRAINT out_of_use_register_section_check CHECK (section IN ('INFRA', 'UPS'));

DROP INDEX IF EXISTS idx_out_of_use_register_section;
CREATE INDEX IF NOT EXISTS idx_out_of_use_register_order ON out_of_use_register (section, rag, sort_order, since);

COMMENT ON COLUMN out_of_use_register.rag        IS 'Ops rating of operational impact: RED significant, AMBER minimal, GREEN none expected. NULL = not yet assessed.';
COMMENT ON COLUMN out_of_use_register.ops_impact IS 'Ops narrative: what this out-of-use asset means for the train service.';
COMMENT ON COLUMN out_of_use_register.detail     IS 'Maintenance narrative: the issue that took the asset out of use and the restrictions imposed.';
COMMENT ON COLUMN out_of_use_register.plan       IS 'Infrastructure: repair requirements and timescale. UPS: plan for rectification.';
