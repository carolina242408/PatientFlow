CREATE TABLE clinical_services (
    id UUID PRIMARY KEY,
    unit_id UUID NOT NULL REFERENCES healthcare_units(id),
    code VARCHAR(255) NOT NULL CHECK (btrim(code) <> ''),
    name VARCHAR(255) NOT NULL CHECK (btrim(name) <> ''),
    UNIQUE (unit_id, code)
);

-- Give pre-existing wards an explicit clinical service, independently of their physical location.
INSERT INTO clinical_services (id, unit_id, code, name)
SELECT gen_random_uuid(), id, 'GENERAL', 'Serviço geral' FROM healthcare_units;
ALTER TABLE wards ADD COLUMN service_id UUID REFERENCES clinical_services(id);
UPDATE wards w SET service_id = s.id FROM wings wi, floors f, buildings b, clinical_services s
WHERE w.wing_id = wi.id AND wi.floor_id = f.id AND f.building_id = b.id
  AND s.unit_id = b.unit_id AND s.code = 'GENERAL';
ALTER TABLE wards ALTER COLUMN service_id SET NOT NULL;
CREATE INDEX ix_wards_service ON wards(service_id);

ALTER TABLE beds DROP CONSTRAINT beds_status_check;
ALTER TABLE beds ADD CONSTRAINT beds_status_check
    CHECK (status IN ('AVAILABLE', 'OCCUPIED', 'BLOCKED', 'CLEANING'));
ALTER TABLE beds ADD COLUMN status_reason VARCHAR(255);

ALTER TABLE patients ADD COLUMN version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE encounters ADD COLUMN version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE encounters ADD COLUMN expected_discharge_at TIMESTAMP(6) WITH TIME ZONE;
ALTER TABLE encounters ADD COLUMN clinical_discharge_at TIMESTAMP(6) WITH TIME ZONE;
ALTER TABLE encounters ADD COLUMN service_id UUID REFERENCES clinical_services(id);
UPDATE encounters e SET service_id = (
    SELECT w.service_id FROM location_allocations a
    JOIN beds b ON b.id=a.bed_id JOIN rooms r ON r.id=b.room_id JOIN wards w ON w.id=r.ward_id
    WHERE a.encounter_id=e.id ORDER BY a.assigned_at DESC, a.id DESC LIMIT 1
);
ALTER TABLE encounters ADD CONSTRAINT ck_expected_discharge
    CHECK (expected_discharge_at IS NULL OR start_period IS NULL OR expected_discharge_at >= start_period);
ALTER TABLE encounters ADD CONSTRAINT ck_clinical_discharge
    CHECK (clinical_discharge_at IS NULL OR start_period IS NULL OR clinical_discharge_at >= start_period);
ALTER TABLE encounters ADD CONSTRAINT ck_administrative_discharge
    CHECK (clinical_discharge_at IS NULL OR end_period IS NULL OR end_period >= clinical_discharge_at);
CREATE INDEX ix_encounters_service ON encounters(service_id);
CREATE UNIQUE INDEX uq_active_encounter_patient ON encounters(patient_id) WHERE status = 'IN_PROGRESS';

CREATE TABLE admission_requests (
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
CREATE UNIQUE INDEX uq_waiting_patient ON admission_requests(patient_id) WHERE status = 'WAITING';
CREATE INDEX ix_waiting_queue ON admission_requests(service_id, status, priority, requested_at);
