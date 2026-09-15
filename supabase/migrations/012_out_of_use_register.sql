-- DLog2 — Out of Use Infrastructure Register
--
-- A standing register of infrastructure that is out of use (short term, long
-- term) and UPS units that are offline. It is NOT part of the daily log
-- workflow: maintenance own it and keep it current through the standalone
-- /out-of-use page, which has no route back into the main DLog2 app. Control
-- put no effort in — every log build simply reads the register as it stands
-- and prints it as the final section of the PDF.
--
-- One row per item. `section` picks the register table it appears in and
-- which columns are meaningful:
--   SHORT_TERM  item, elr, restriction, since, ref            (+ optional detail/owner/plan)
--   LONG_TERM   item, elr, restriction, since, ref, detail, owner, plan
--   UPS         item (UPS / site), plan (rectification), impact (on failure)
-- Fields that don't apply to a section are simply left blank.

CREATE TABLE IF NOT EXISTS out_of_use_register (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  section      text        NOT NULL CHECK (section IN ('SHORT_TERM', 'LONG_TERM', 'UPS')),

  item         text        NOT NULL,            -- Infrastructure item and location / UPS site
  elr          text        NOT NULL DEFAULT '',
  restriction  text        NOT NULL DEFAULT '',  -- Restriction and impact
  since        date,                            -- Out of use since
  ref          text        NOT NULL DEFAULT '',  -- FMS / CCIL / Ellipse reference
  detail       text        NOT NULL DEFAULT '',
  owner        text        NOT NULL DEFAULT '',  -- e.g. IME Derby
  plan         text        NOT NULL DEFAULT '',  -- Repair timescale / plan for rectification
  impact       text        NOT NULL DEFAULT '',  -- UPS: impact on failure

  sort_order   integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text        NOT NULL DEFAULT ''   -- free-text name of the last editor
);

CREATE INDEX IF NOT EXISTS idx_out_of_use_register_section ON out_of_use_register (section, sort_order, since);

-- Maintenance staff edit this from a browser with the public anon key, the
-- same posture as the rest of the app's tables. Tighten alongside them when
-- the project moves to authenticated access.
ALTER TABLE out_of_use_register ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open_all_out_of_use_register" ON out_of_use_register
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE out_of_use_register IS
  'Standing register of out-of-use infrastructure and offline UPS units, maintained by maintenance via /out-of-use and printed as the last section of every daily log PDF.';
