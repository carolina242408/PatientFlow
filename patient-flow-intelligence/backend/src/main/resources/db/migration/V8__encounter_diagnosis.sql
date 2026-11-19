ALTER TABLE encounters ADD COLUMN IF NOT EXISTS diagnosis_code VARCHAR(64);
CREATE INDEX IF NOT EXISTS ix_encounter_service_diagnosis_finished ON encounters(service_id, diagnosis_code, end_period) WHERE status='FINISHED';
