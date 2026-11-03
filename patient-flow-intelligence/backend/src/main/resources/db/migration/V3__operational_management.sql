-- 1. Inserir um Serviço Geral por cada Piso existente para retrocompatibilidade/seed (opcional)
INSERT INTO clinical_services (id, floor_id, code, name)
SELECT gen_random_uuid(), id, 'GENERAL', 'Serviço Geral' FROM floors
ON CONFLICT DO NOTHING;

-- 2. Atualizações em Beds
ALTER TABLE beds DROP CONSTRAINT IF EXISTS beds_status_check;
ALTER TABLE beds ADD CONSTRAINT beds_status_check
    CHECK (status IN ('AVAILABLE', 'OCCUPIED', 'BLOCKED', 'CLEANING'));
ALTER TABLE beds ADD COLUMN IF NOT EXISTS status_reason VARCHAR(255);

-- 3. Atualizações em Patients e Encounters
ALTER TABLE patients ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;

ALTER TABLE encounters ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS expected_discharge_at TIMESTAMP(6) WITH TIME ZONE;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS clinical_discharge_at TIMESTAMP(6) WITH TIME ZONE;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES clinical_services(id);

-- Associar encontros ativos ao serviço correspondente via alocação de cama
UPDATE encounters e SET service_id = (
    SELECT s.id 
    FROM location_allocations a
    JOIN beds b ON b.id = a.bed_id 
    JOIN rooms r ON r.id = b.room_id 
    JOIN wards w ON w.id = r.ward_id
    JOIN wings wi ON wi.id = w.wing_id
    JOIN clinical_services s ON s.id = wi.service_id
    WHERE a.encounter_id = e.id 
    ORDER BY a.assigned_at DESC, a.id DESC LIMIT 1
);

ALTER TABLE encounters DROP CONSTRAINT IF EXISTS ck_expected_discharge;
ALTER TABLE encounters ADD CONSTRAINT ck_expected_discharge
    CHECK (expected_discharge_at IS NULL OR start_period IS NULL OR expected_discharge_at >= start_period);

ALTER TABLE encounters DROP CONSTRAINT IF EXISTS ck_clinical_discharge;
ALTER TABLE encounters ADD CONSTRAINT ck_clinical_discharge
    CHECK (clinical_discharge_at IS NULL OR start_period IS NULL OR clinical_discharge_at >= start_period);

ALTER TABLE encounters DROP CONSTRAINT IF EXISTS ck_administrative_discharge;
ALTER TABLE encounters ADD CONSTRAINT ck_administrative_discharge
    CHECK (clinical_discharge_at IS NULL OR end_period IS NULL OR end_period >= clinical_discharge_at);

CREATE INDEX IF NOT EXISTS ix_encounters_service ON encounters(service_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_encounter_patient ON encounters(patient_id) WHERE status = 'IN_PROGRESS';

-- 4. Admission Requests
CREATE TABLE IF NOT EXISTS admission_requests (
    id UUID PRIMARY KEY,
    request_number VARCHAR(255) NOT NULL UNIQUE CHECK (btrim(request_number) <> ''),
    patient_id UUID NOT NULL REFERENCES patients(id),
    service_id UUID NOT NULL REFERENCES clinical_services(id),
    origin VARCHAR(32) NOT NULL CHECK (origin IN ('EMERGENCY', 'SCHEDULED', 'SURGICAL', 'TRANSFER', 'OTHER')),
    priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 5),
    requested_at TIMESTAMP(6) WITH TIME ZONE NOT NULL,
    desired_admission_at TIMESTAMP(6) WITH TIME ZONE,
    status VARCHAR(32) NOT NULL CHECK (status IN ('WAITING', 'ADMITTED', 'CANCELLED')),
    encounter_id UUID UNIQUE REFERENCES encounters(id),
    closed_at TIMESTAMP(6) WITH TIME ZONE,
    version BIGINT NOT NULL DEFAULT 0,
    CHECK (desired_admission_at IS NULL OR desired_admission_at >= requested_at),
    CHECK ((status = 'WAITING' AND encounter_id IS NULL AND closed_at IS NULL)
        OR (status = 'ADMITTED' AND encounter_id IS NOT NULL AND closed_at IS NOT NULL)
        OR (status = 'CANCELLED' AND encounter_id IS NULL AND closed_at IS NOT NULL)),
    CHECK (closed_at IS NULL OR closed_at >= requested_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_waiting_patient ON admission_requests(patient_id) WHERE status = 'WAITING';
CREATE INDEX IF NOT EXISTS ix_waiting_queue ON admission_requests(service_id, status, priority, requested_at);