-- DLog2 — Global app settings storage
-- Allows category configuration and label overrides to be shared across all devices/users.

CREATE TABLE IF NOT EXISTS app_settings (
  key        text        PRIMARY KEY,
  value      jsonb       NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all_app_settings" ON app_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
