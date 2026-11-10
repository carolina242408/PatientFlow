-- ============================================================================
-- V6: HAPI FHIR -> PostgreSQL Hybrid ETL Stored Procedures & Watermark State
-- ============================================================================

-- 1. Watermark table for tracking ingestion progress (live pipeline & future batch polling)
CREATE TABLE IF NOT EXISTS fhir_sync_watermarks (
    source_key VARCHAR(255) PRIMARY KEY CHECK (btrim(source_key) <> ''),
    last_updated TIMESTAMP(6) WITH TIME ZONE,
    last_resource_id VARCHAR(255),
    bundles_processed BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 2. Helper function to idempotently resolve or create the full hospital hierarchy for a bed/location
CREATE OR REPLACE FUNCTION fn_ensure_bed_hierarchy(p_loc JSONB)
RETURNS TABLE (
    out_bed_id UUID,
    out_room_id UUID,
    out_ward_id UUID,
    out_service_id UUID,
    out_created_new BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_uls_name VARCHAR(255);
    v_unit_name VARCHAR(255);
    v_building_name VARCHAR(255);
    v_floor_name VARCHAR(255);
    v_service_code VARCHAR(255);
    v_service_name VARCHAR(255);
    v_wing_name VARCHAR(255);
    v_ward_code VARCHAR(255);
    v_ward_name VARCHAR(255);
    v_room_code VARCHAR(255);
    v_bed_code VARCHAR(255);
    v_initial_status VARCHAR(255);

    v_uls_id UUID;
    v_unit_id UUID;
    v_building_id UUID;
    v_floor_id UUID;
    v_service_id UUID;
    v_wing_id UUID;
    v_ward_id UUID;
    v_room_id UUID;
    v_bed_id UUID;
    v_created BOOLEAN := FALSE;
BEGIN
    v_ward_code := left(btrim(COALESCE(p_loc->>'wardCode', '')), 255);
    v_room_code := left(btrim(COALESCE(p_loc->>'roomCode', '')), 255);
    v_bed_code  := left(btrim(COALESCE(p_loc->>'bedCode', '')), 255);

    IF v_ward_code = '' THEN
        RETURN;
    END IF;

    -- Serialize hierarchy creation per ward code to avoid race conditions
    PERFORM pg_advisory_xact_lock(hashtextextended('hierarchy:ward:' || v_ward_code, 0));

    -- Hospital configuration!!!
    v_uls_name      := left(COALESCE(NULLIF(btrim(p_loc->>'ulsName'), ''), 'ULS Hospitalar'), 255);
    v_unit_name     := left(COALESCE(NULLIF(btrim(p_loc->>'unitName'), ''), 'Unidade Hospitalar Principal'), 255);
    v_building_name := left(COALESCE(NULLIF(btrim(p_loc->>'buildingName'), ''), 'Edifício Principal'), 255);
    v_floor_name    := left(COALESCE(NULLIF(btrim(p_loc->>'floorName'), ''), 'Piso 1'), 255);
    v_service_code  := left(COALESCE(NULLIF(btrim(p_loc->>'serviceCode'), ''),
                            NULLIF(btrim(regexp_replace(v_ward_code, '^Ward\s+', '', 'i')), ''),
                            v_ward_code), 255);
    v_ward_name     := left(COALESCE(NULLIF(btrim(p_loc->>'wardName'), ''), v_ward_code), 255);
    v_service_name  := left(COALESCE(NULLIF(btrim(p_loc->>'serviceName'), ''), v_ward_name), 255);
    v_wing_name     := left(COALESCE(NULLIF(btrim(p_loc->>'wingName'), ''), 'Ala ' || v_service_code), 255);
    v_initial_status := COALESCE(NULLIF(btrim(p_loc->>'operationalStatus'), ''), 'AVAILABLE');
    IF v_initial_status NOT IN ('AVAILABLE', 'OCCUPIED', 'BLOCKED', 'CLEANING') THEN
        v_initial_status := 'AVAILABLE';
    END IF;

    -- Check if the ward already exists
    SELECT w.id, wi.service_id
      INTO v_ward_id, v_service_id
      FROM wards w
      JOIN wings wi ON wi.id = w.wing_id
     WHERE w.code = v_ward_code;

    IF v_ward_id IS NULL THEN
        -- 1. ULS (reuse existing ULS if ulsName was not explicitly specified, so user scopes match)
        SELECT id INTO v_uls_id FROM uls WHERE name = v_uls_name LIMIT 1;
        IF v_uls_id IS NULL AND NULLIF(btrim(p_loc->>'ulsName'), '') IS NULL THEN
            SELECT id INTO v_uls_id FROM uls ORDER BY name, id LIMIT 1;
        END IF;
        IF v_uls_id IS NULL THEN
            v_uls_id := gen_random_uuid();
            INSERT INTO uls (id, name) VALUES (v_uls_id, v_uls_name);
        END IF;

        -- 2. Healthcare Unit
        SELECT id INTO v_unit_id FROM healthcare_units WHERE uls_id = v_uls_id AND name = v_unit_name LIMIT 1;
        IF v_unit_id IS NULL AND NULLIF(btrim(p_loc->>'unitName'), '') IS NULL THEN
            SELECT id INTO v_unit_id FROM healthcare_units WHERE uls_id = v_uls_id ORDER BY name, id LIMIT 1;
        END IF;
        IF v_unit_id IS NULL THEN
            v_unit_id := gen_random_uuid();
            INSERT INTO healthcare_units (id, name, uls_id) VALUES (v_unit_id, v_unit_name, v_uls_id);
        END IF;

        -- 3. Building
        SELECT id INTO v_building_id FROM buildings WHERE unit_id = v_unit_id AND name = v_building_name LIMIT 1;
        IF v_building_id IS NULL THEN
            v_building_id := gen_random_uuid();
            INSERT INTO buildings (id, name, unit_id) VALUES (v_building_id, v_building_name, v_unit_id);
        END IF;

        -- 4. Floor
        SELECT id INTO v_floor_id FROM floors WHERE building_id = v_building_id AND level_name = v_floor_name LIMIT 1;
        IF v_floor_id IS NULL THEN
            v_floor_id := gen_random_uuid();
            INSERT INTO floors (id, level_name, building_id) VALUES (v_floor_id, v_floor_name, v_building_id);
        END IF;

        -- 5. Clinical Service
        SELECT id INTO v_service_id FROM clinical_services WHERE floor_id = v_floor_id AND code = v_service_code LIMIT 1;
        IF v_service_id IS NULL THEN
            v_service_id := gen_random_uuid();
            INSERT INTO clinical_services (id, code, name, floor_id)
            VALUES (v_service_id, v_service_code, v_service_name, v_floor_id)
            ON CONFLICT (floor_id, code) DO UPDATE SET name = EXCLUDED.name
            RETURNING id INTO v_service_id;
        END IF;

        -- 6. Wing
        SELECT id INTO v_wing_id FROM wings WHERE service_id = v_service_id AND name = v_wing_name LIMIT 1;
        IF v_wing_id IS NULL THEN
            v_wing_id := gen_random_uuid();
            INSERT INTO wings (id, name, service_id) VALUES (v_wing_id, v_wing_name, v_service_id);
        END IF;

        -- 7. Ward
        v_ward_id := gen_random_uuid();
        INSERT INTO wards (id, code, name, wing_id)
        VALUES (v_ward_id, v_ward_code, v_ward_name, v_wing_id)
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
        RETURNING id INTO v_ward_id;
    ELSE
        -- Update ward & service name if a richer human-readable name arrived (e.g. from hospital-locations.json)
        IF NULLIF(btrim(p_loc->>'wardName'), '') IS NOT NULL AND (p_loc->>'wardName') <> v_ward_code THEN
            UPDATE wards SET name = v_ward_name WHERE id = v_ward_id AND name = code;
            UPDATE clinical_services SET name = v_service_name WHERE id = v_service_id AND name = code;
        END IF;
    END IF;

    -- 8. Room (optional if location entry is only ward-level)
    IF v_room_code <> '' THEN
        SELECT id INTO v_room_id FROM rooms WHERE ward_id = v_ward_id AND code = v_room_code;
        IF v_room_id IS NULL THEN
            v_room_id := gen_random_uuid();
            INSERT INTO rooms (id, code, ward_id)
            VALUES (v_room_id, v_room_code, v_ward_id)
            ON CONFLICT (ward_id, code) DO NOTHING;
            SELECT id INTO v_room_id FROM rooms WHERE ward_id = v_ward_id AND code = v_room_code;
        END IF;
    END IF;

    -- 9. Bed (optional if location entry is only ward/room-level)
    IF v_bed_code <> '' AND v_room_id IS NOT NULL THEN
        SELECT id INTO v_bed_id FROM beds WHERE room_id = v_room_id AND code = v_bed_code;
        IF v_bed_id IS NULL THEN
            v_bed_id := gen_random_uuid();
            INSERT INTO beds (id, code, room_id, status, version)
            VALUES (v_bed_id, v_bed_code, v_room_id, v_initial_status, 0)
            ON CONFLICT (room_id, code) DO NOTHING;
            SELECT id INTO v_bed_id FROM beds WHERE room_id = v_room_id AND code = v_bed_code;
            v_created := TRUE;
        END IF;
    END IF;

    RETURN QUERY SELECT v_bed_id, v_room_id, v_ward_id, v_service_id, v_created;
END;
$$;


-- 3. Primary Stored Function: Ingest transformed FHIR JSONB payload into PostgreSQL
CREATE OR REPLACE FUNCTION sp_ingest_fhir_payload(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_source VARCHAR(255);
    v_auto_locations BOOLEAN;
    v_loc JSONB;
    v_pat JSONB;
    v_enc JSONB;
    v_alloc JSONB;

    v_locations_upserted INT := 0;
    v_patients_upserted INT := 0;
    v_encounters_processed INT := 0;
    v_allocations_changed INT := 0;
    v_events JSONB := '[]'::jsonb;

    -- Patient variables
    v_sns VARCHAR(255);
    v_hosp_num VARCHAR(255);
    v_full_name VARCHAR(255);
    v_birth_date DATE;
    v_gender VARCHAR(255);
    v_patient_id UUID;
    v_existing_pat RECORD;

    -- Encounter & Location variables
    v_visit_number VARCHAR(255);
    v_status VARCHAR(255);
    v_start_period TIMESTAMP(6) WITH TIME ZONE;
    v_end_period TIMESTAMP(6) WITH TIME ZONE;
    v_event_time TIMESTAMP(6) WITH TIME ZONE;
    v_bed_id UUID;
    v_room_id UUID;
    v_ward_id UUID;
    v_service_id UUID;
    v_created_new BOOLEAN;

    v_existing_enc RECORD;
    v_open_alloc RECORD;
    v_stale_enc RECORD;
    v_stale_alloc RECORD;
    v_enc_id UUID;
    v_eff_start TIMESTAMP(6) WITH TIME ZONE;
    v_eff_end TIMESTAMP(6) WITH TIME ZONE;
    v_transfer_at TIMESTAMP(6) WITH TIME ZONE;
    v_discharge_at TIMESTAMP(6) WITH TIME ZONE;

    v_mov_bed_id UUID;
    v_mov_service_id UUID;
    v_mov_start TIMESTAMP(6) WITH TIME ZONE;
    v_mov_end TIMESTAMP(6) WITH TIME ZONE;
BEGIN
    IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
        RAISE EXCEPTION 'FHIR ingestion payload must be a JSON object';
    END IF;

    v_source := left(COALESCE(NULLIF(btrim(p_payload->>'source'), ''), 'INGESTION_PIPELINE'), 255);
    v_auto_locations := COALESCE((p_payload->>'autoCreateLocations')::boolean, TRUE);

    -- ========================================================================
    -- STEP 1: Upsert Hospital Locations Hierarchy (if present in payload)
    -- ========================================================================
    IF jsonb_typeof(p_payload->'locations') = 'array' THEN
        FOR v_loc IN SELECT value FROM jsonb_array_elements(p_payload->'locations')
        LOOP
            SELECT out_bed_id, out_room_id, out_ward_id, out_service_id, out_created_new
              INTO v_bed_id, v_room_id, v_ward_id, v_service_id, v_created_new
              FROM fn_ensure_bed_hierarchy(v_loc);

            IF v_ward_id IS NOT NULL THEN
                v_locations_upserted := v_locations_upserted + 1;
            END IF;
        END LOOP;
    END IF;

    -- ========================================================================
    -- STEP 2: Upsert Patients
    -- ========================================================================
    IF jsonb_typeof(p_payload->'patients') = 'array' THEN
        FOR v_pat IN SELECT value FROM jsonb_array_elements(p_payload->'patients')
        LOOP
            v_sns := left(btrim(COALESCE(v_pat->>'snsNumber', '')), 255);
            IF v_sns = '' THEN
                CONTINUE;
            END IF;

            PERFORM pg_advisory_xact_lock(hashtextextended('patient:' || v_sns, 0));

            v_hosp_num  := left(NULLIF(btrim(COALESCE(v_pat->>'hospitalNumber', '')), ''), 255);
            v_full_name := left(COALESCE(NULLIF(btrim(v_pat->>'fullName'), ''), 'Doente ' || v_sns), 255);
            v_gender    := left(COALESCE(NULLIF(btrim(v_pat->>'gender'), ''), 'unknown'), 255);
            BEGIN
                v_birth_date := NULLIF(btrim(COALESCE(v_pat->>'birthDate', '')), '')::date;
            EXCEPTION WHEN OTHERS THEN
                v_birth_date := NULL;
            END;

            SELECT * INTO v_existing_pat FROM patients WHERE sns_number = v_sns FOR UPDATE;

            IF v_existing_pat.id IS NULL THEN
                v_patient_id := gen_random_uuid();
                INSERT INTO patients (id, sns_number, hospital_number, full_name, birth_date, gender, version)
                VALUES (v_patient_id, v_sns, v_hosp_num, v_full_name, v_birth_date, v_gender, 0);

                v_patients_upserted := v_patients_upserted + 1;
                v_events := v_events || jsonb_build_array(jsonb_build_object(
                    'type', 'PATIENT_CREATED',
                    'resource', 'PATIENT',
                    'id', v_patient_id::text
                ));
            ELSE
                v_patient_id := v_existing_pat.id;
                IF v_existing_pat.full_name IS DISTINCT FROM v_full_name
                   OR (v_hosp_num IS NOT NULL AND v_existing_pat.hospital_number IS DISTINCT FROM v_hosp_num)
                   OR (v_birth_date IS NOT NULL AND v_existing_pat.birth_date IS DISTINCT FROM v_birth_date)
                   OR (v_gender <> 'unknown' AND v_existing_pat.gender IS DISTINCT FROM v_gender)
                THEN
                    UPDATE patients
                       SET full_name = v_full_name,
                           hospital_number = COALESCE(v_hosp_num, hospital_number),
                           birth_date = COALESCE(v_birth_date, birth_date),
                           gender = CASE WHEN v_gender <> 'unknown' THEN v_gender ELSE gender END,
                           version = version + 1
                     WHERE id = v_patient_id;

                    v_patients_upserted := v_patients_upserted + 1;
                    v_events := v_events || jsonb_build_array(jsonb_build_object(
                        'type', 'PATIENT_UPDATED',
                        'resource', 'PATIENT',
                        'id', v_patient_id::text
                    ));
                END IF;
            END IF;
        END LOOP;
    END IF;

    -- ========================================================================
    -- STEP 3: Process Encounters & Bed Allocations (A01 / A02 / A03 / Batch)
    -- ========================================================================
    IF jsonb_typeof(p_payload->'encounters') = 'array' THEN
        FOR v_enc IN SELECT value FROM jsonb_array_elements(p_payload->'encounters')
        LOOP
            v_visit_number := left(btrim(COALESCE(v_enc->>'visitNumber', '')), 255);
            v_sns          := left(btrim(COALESCE(v_enc->>'snsNumber', '')), 255);
            IF v_visit_number = '' OR v_sns = '' THEN
                CONTINUE;
            END IF;

            -- Acquire transaction-scoped advisory locks matching OperationLocks.java
            PERFORM pg_advisory_xact_lock(hashtextextended('visit:' || v_visit_number, 0));
            PERFORM pg_advisory_xact_lock(hashtextextended('patient:' || v_sns, 0));

            SELECT id INTO v_patient_id FROM patients WHERE sns_number = v_sns;
            IF v_patient_id IS NULL THEN
                CONTINUE;
            END IF;

            v_status := UPPER(btrim(COALESCE(v_enc->>'status', 'IN_PROGRESS')));
            IF v_status NOT IN ('IN_PROGRESS', 'FINISHED') THEN
                v_status := 'IN_PROGRESS';
            END IF;

            v_start_period := date_trunc('microseconds', NULLIF(btrim(COALESCE(v_enc->>'startPeriod', '')), '')::timestamptz);
            v_end_period   := date_trunc('microseconds', NULLIF(btrim(COALESCE(v_enc->>'endPeriod', '')), '')::timestamptz);
            v_event_time   := date_trunc('microseconds', NULLIF(btrim(COALESCE(v_enc->>'eventTime', '')), '')::timestamptz);

            -- Resolve or auto-create the primary target bed hierarchy
            v_bed_id := NULL;
            v_service_id := NULL;
            IF v_auto_locations THEN
                SELECT out_bed_id, out_room_id, out_ward_id, out_service_id, out_created_new
                  INTO v_bed_id, v_room_id, v_ward_id, v_service_id, v_created_new
                  FROM fn_ensure_bed_hierarchy(v_enc);
            ELSE
                SELECT b.id, wi.service_id
                  INTO v_bed_id, v_service_id
                  FROM beds b
                  JOIN rooms r ON r.id = b.room_id
                  JOIN wards w ON w.id = r.ward_id
                  JOIN wings wi ON wi.id = w.wing_id
                 WHERE w.code = btrim(v_enc->>'wardCode')
                   AND r.code = btrim(v_enc->>'roomCode')
                   AND b.code = btrim(v_enc->>'bedCode');
            END IF;

            IF v_bed_id IS NULL THEN
                CONTINUE;
            END IF;

            -- Lock the target bed
            PERFORM 1 FROM beds WHERE id = v_bed_id FOR UPDATE;

            -- Check if encounter already exists
            SELECT * INTO v_existing_enc FROM encounters WHERE visit_number = v_visit_number FOR UPDATE;

            IF v_existing_enc.id IS NULL THEN
                -- ============================================================
                -- NEW ENCOUNTER (A01 Admission, Census A02/A03, or Batch Load)
                -- ============================================================
                v_enc_id := gen_random_uuid();

                IF v_status = 'IN_PROGRESS' THEN
                    v_eff_start := COALESCE(v_start_period, v_event_time, date_trunc('microseconds', now()));

                    -- Close any prior lingering IN_PROGRESS encounter for the same patient (uq_active_encounter_patient)
                    FOR v_stale_enc IN
                        SELECT id, start_period, clinical_discharge_at
                          FROM encounters
                         WHERE patient_id = v_patient_id AND status = 'IN_PROGRESS'
                         FOR UPDATE
                    LOOP
                        FOR v_stale_alloc IN
                            SELECT id, bed_id, assigned_at
                              FROM location_allocations
                             WHERE encounter_id = v_stale_enc.id AND discharged_at IS NULL
                             FOR UPDATE
                        LOOP
                            UPDATE location_allocations
                               SET discharged_at = GREATEST(v_stale_alloc.assigned_at, v_eff_start)
                             WHERE id = v_stale_alloc.id;
                            UPDATE beds
                               SET status = 'CLEANING', status_reason = NULL, version = version + 1
                             WHERE id = v_stale_alloc.bed_id;
                        END LOOP;

                        UPDATE encounters
                           SET status = 'FINISHED',
                               end_period = GREATEST(
                                   COALESCE(v_stale_enc.start_period, v_eff_start),
                                   COALESCE(v_stale_enc.clinical_discharge_at, v_eff_start),
                                   v_eff_start
                               ),
                               version = version + 1
                         WHERE id = v_stale_enc.id;
                    END LOOP;

                    -- Ensure target bed has no lingering open allocation from another encounter (uq_open_allocation_bed)
                    FOR v_stale_alloc IN
                        SELECT id, encounter_id, assigned_at
                          FROM location_allocations
                         WHERE bed_id = v_bed_id AND discharged_at IS NULL
                         FOR UPDATE
                    LOOP
                        UPDATE location_allocations
                           SET discharged_at = GREATEST(v_stale_alloc.assigned_at, COALESCE(v_event_time, v_eff_start))
                         WHERE id = v_stale_alloc.id;

                        UPDATE encounters
                           SET status = 'FINISHED',
                               end_period = GREATEST(
                                   COALESCE(start_period, v_eff_start),
                                   COALESCE(clinical_discharge_at, v_eff_start),
                                   v_stale_alloc.assigned_at,
                                   COALESCE(v_event_time, v_eff_start)
                               ),
                               version = version + 1
                         WHERE id = v_stale_alloc.encounter_id AND status = 'IN_PROGRESS';
                    END LOOP;

                    INSERT INTO encounters (id, visit_number, patient_id, status, start_period, end_period, service_id, version)
                    VALUES (v_enc_id, v_visit_number, v_patient_id, 'IN_PROGRESS', v_eff_start, NULL, v_service_id, 0);

                    -- Insert any historical closed movements if provided in allocations array
                    IF jsonb_typeof(v_enc->'allocations') = 'array' AND jsonb_array_length(v_enc->'allocations') > 1 THEN
                        FOR v_alloc IN SELECT value FROM jsonb_array_elements(v_enc->'allocations')
                        LOOP
                            IF NULLIF(btrim(COALESCE(v_alloc->>'dischargedAt', '')), '') IS NOT NULL THEN
                                SELECT out_bed_id INTO v_mov_bed_id FROM fn_ensure_bed_hierarchy(v_alloc);
                                IF v_mov_bed_id IS NOT NULL THEN
                                    v_mov_start := COALESCE(date_trunc('microseconds', (v_alloc->>'assignedAt')::timestamptz), v_eff_start);
                                    v_mov_end   := GREATEST(v_mov_start, date_trunc('microseconds', (v_alloc->>'dischargedAt')::timestamptz));
                                    INSERT INTO location_allocations (id, encounter_id, bed_id, assigned_at, discharged_at)
                                    VALUES (gen_random_uuid(), v_enc_id, v_mov_bed_id, v_mov_start, v_mov_end);
                                    v_allocations_changed := v_allocations_changed + 1;
                                END IF;
                            END IF;
                        END LOOP;
                    END IF;

                    -- Insert current open allocation
                    INSERT INTO location_allocations (id, encounter_id, bed_id, assigned_at, discharged_at)
                    VALUES (gen_random_uuid(), v_enc_id, v_bed_id, GREATEST(v_eff_start, COALESCE(v_event_time, v_eff_start)), NULL);

                    UPDATE beds
                       SET status = 'OCCUPIED', status_reason = NULL, version = version + 1
                     WHERE id = v_bed_id;

                    v_encounters_processed := v_encounters_processed + 1;
                    v_allocations_changed := v_allocations_changed + 1;
                    v_events := v_events || jsonb_build_array(jsonb_build_object(
                        'type', 'PATIENT_ADMITTED',
                        'resource', 'ENCOUNTER',
                        'id', v_enc_id::text
                    ));

                ELSE
                    -- New encounter arriving already FINISHED (e.g. census discharge A03 or historical batch)
                    v_eff_start := COALESCE(v_start_period, v_end_period, v_event_time, date_trunc('microseconds', now()));
                    v_eff_end   := GREATEST(v_eff_start, COALESCE(v_end_period, v_event_time, v_eff_start));

                    INSERT INTO encounters (id, visit_number, patient_id, status, start_period, end_period, service_id, version)
                    VALUES (v_enc_id, v_visit_number, v_patient_id, 'FINISHED', v_eff_start, v_eff_end, v_service_id, 0);

                    IF jsonb_typeof(v_enc->'allocations') = 'array' AND jsonb_array_length(v_enc->'allocations') > 0 THEN
                        FOR v_alloc IN SELECT value FROM jsonb_array_elements(v_enc->'allocations')
                        LOOP
                            SELECT out_bed_id INTO v_mov_bed_id FROM fn_ensure_bed_hierarchy(v_alloc);
                            IF v_mov_bed_id IS NOT NULL THEN
                                v_mov_start := COALESCE(date_trunc('microseconds', NULLIF(btrim(COALESCE(v_alloc->>'assignedAt', '')), '')::timestamptz), v_eff_start);
                                v_mov_end   := GREATEST(v_mov_start, COALESCE(date_trunc('microseconds', NULLIF(btrim(COALESCE(v_alloc->>'dischargedAt', '')), '')::timestamptz), v_eff_end));
                                INSERT INTO location_allocations (id, encounter_id, bed_id, assigned_at, discharged_at)
                                VALUES (gen_random_uuid(), v_enc_id, v_mov_bed_id, v_mov_start, v_mov_end);
                                v_allocations_changed := v_allocations_changed + 1;
                            END IF;
                        END LOOP;
                    ELSE
                        INSERT INTO location_allocations (id, encounter_id, bed_id, assigned_at, discharged_at)
                        VALUES (gen_random_uuid(), v_enc_id, v_bed_id, v_eff_start, v_eff_end);
                        v_allocations_changed := v_allocations_changed + 1;
                    END IF;

                    -- If target bed is not currently occupied by an active allocation, mark it CLEANING
                    IF NOT EXISTS (SELECT 1 FROM location_allocations WHERE bed_id = v_bed_id AND discharged_at IS NULL) THEN
                        UPDATE beds
                           SET status = 'CLEANING', status_reason = NULL, version = version + 1
                         WHERE id = v_bed_id AND status <> 'CLEANING';
                    END IF;

                    v_encounters_processed := v_encounters_processed + 1;
                    v_events := v_events || jsonb_build_array(jsonb_build_object(
                        'type', 'PATIENT_DISCHARGED',
                        'resource', 'ENCOUNTER',
                        'id', v_enc_id::text
                    ));
                END IF;

            ELSE
                -- ============================================================
                -- EXISTING ENCOUNTER (Transfer A02, Discharge A03, or Duplicate)
                -- ============================================================
                v_enc_id := v_existing_enc.id;

                SELECT * INTO v_open_alloc
                  FROM location_allocations
                 WHERE encounter_id = v_enc_id AND discharged_at IS NULL
                 ORDER BY assigned_at DESC, id DESC
                 LIMIT 1
                 FOR UPDATE;

                IF v_status = 'IN_PROGRESS' THEN
                    -- An A01 (admission) for an encounter that already exists is always a duplicate/replayed message, never a transfer
                    IF UPPER(btrim(COALESCE(v_enc->>'trigger', ''))) = 'A01' THEN
                        CONTINUE;
                    END IF;

                    -- Only process transfer if encounter is still IN_PROGRESS
                    IF v_existing_enc.status = 'IN_PROGRESS' THEN
                        IF v_open_alloc.id IS NULL OR v_open_alloc.bed_id IS DISTINCT FROM v_bed_id THEN
                            -- Chronological guard: a real transfer (A02) must have an event timestamp strictly after the current allocation's assigned_at
                            v_transfer_at := COALESCE(v_event_time, v_start_period);
                            IF v_open_alloc.id IS NOT NULL AND (v_transfer_at IS NULL OR v_transfer_at <= v_open_alloc.assigned_at) THEN
                                CONTINUE;
                            END IF;
                            v_transfer_at := COALESCE(v_transfer_at, date_trunc('microseconds', now()));

                            -- Idempotency guard: skip if this exact (encounter, bed, assigned_at) allocation already exists
                            IF EXISTS (
                                SELECT 1 FROM location_allocations
                                 WHERE encounter_id = v_enc_id
                                   AND bed_id = v_bed_id
                                   AND assigned_at = v_transfer_at
                            ) THEN
                                CONTINUE;
                            END IF;

                            IF v_open_alloc.id IS NOT NULL THEN
                                UPDATE location_allocations
                                   SET discharged_at = v_transfer_at
                                 WHERE id = v_open_alloc.id;

                                UPDATE beds
                                   SET status = 'CLEANING', status_reason = NULL, version = version + 1
                                 WHERE id = v_open_alloc.bed_id;
                            END IF;

                            -- Ensure destination bed has no stale open allocation
                            FOR v_stale_alloc IN
                                SELECT id, encounter_id, assigned_at
                                  FROM location_allocations
                                 WHERE bed_id = v_bed_id AND discharged_at IS NULL
                                 FOR UPDATE
                            LOOP
                                UPDATE location_allocations
                                   SET discharged_at = GREATEST(v_stale_alloc.assigned_at, v_transfer_at)
                                 WHERE id = v_stale_alloc.id;

                                UPDATE encounters
                                   SET status = 'FINISHED',
                                       end_period = GREATEST(
                                           COALESCE(start_period, v_transfer_at),
                                           COALESCE(clinical_discharge_at, v_transfer_at),
                                           v_stale_alloc.assigned_at,
                                           v_transfer_at
                                       ),
                                       version = version + 1
                                 WHERE id = v_stale_alloc.encounter_id AND status = 'IN_PROGRESS';
                            END LOOP;

                            INSERT INTO location_allocations (id, encounter_id, bed_id, assigned_at, discharged_at)
                            VALUES (gen_random_uuid(), v_enc_id, v_bed_id, v_transfer_at, NULL);

                            UPDATE beds
                               SET status = 'OCCUPIED', status_reason = NULL, version = version + 1
                             WHERE id = v_bed_id;

                            UPDATE encounters
                               SET service_id = v_service_id,
                                   version = version + 1
                             WHERE id = v_enc_id;

                            v_encounters_processed := v_encounters_processed + 1;
                            v_allocations_changed := v_allocations_changed + 1;
                            v_events := v_events || jsonb_build_array(jsonb_build_object(
                                'type', 'PATIENT_TRANSFERRED',
                                'resource', 'ENCOUNTER',
                                'id', v_enc_id::text
                            ));
                        END IF;
                    END IF;

                ELSE
                    -- Incoming status = FINISHED (Discharge A03)
                    IF v_existing_enc.status = 'IN_PROGRESS' THEN
                        v_discharge_at := GREATEST(
                            COALESCE(v_existing_enc.start_period, '-infinity'::timestamptz),
                            COALESCE(v_existing_enc.clinical_discharge_at, '-infinity'::timestamptz),
                            COALESCE(v_open_alloc.assigned_at, '-infinity'::timestamptz),
                            COALESCE(v_end_period, v_event_time, date_trunc('microseconds', now()))
                        );

                        IF v_open_alloc.id IS NOT NULL THEN
                            UPDATE location_allocations
                               SET discharged_at = v_discharge_at
                             WHERE id = v_open_alloc.id;

                            UPDATE beds
                               SET status = 'CLEANING', status_reason = NULL, version = version + 1
                             WHERE id = v_open_alloc.bed_id;

                            v_allocations_changed := v_allocations_changed + 1;
                        END IF;

                        UPDATE encounters
                           SET status = 'FINISHED',
                               end_period = v_discharge_at,
                               version = version + 1
                         WHERE id = v_enc_id;

                        v_encounters_processed := v_encounters_processed + 1;
                        v_events := v_events || jsonb_build_array(jsonb_build_object(
                            'type', 'PATIENT_DISCHARGED',
                            'resource', 'ENCOUNTER',
                            'id', v_enc_id::text
                        ));
                    END IF;
                END IF;
            END IF;
        END LOOP;
    END IF;

    -- ========================================================================
    -- STEP 4: Update Sync Watermark State
    -- ========================================================================
    INSERT INTO fhir_sync_watermarks (source_key, last_updated, bundles_processed, updated_at)
    VALUES (v_source, COALESCE(v_event_time, now()), 1, now())
    ON CONFLICT (source_key) DO UPDATE
       SET last_updated = GREATEST(fhir_sync_watermarks.last_updated, EXCLUDED.last_updated),
           bundles_processed = fhir_sync_watermarks.bundles_processed + 1,
           updated_at = now();

    RETURN jsonb_build_object(
        'locationsUpserted', v_locations_upserted,
        'patientsUpserted', v_patients_upserted,
        'encountersProcessed', v_encounters_processed,
        'allocationsChanged', v_allocations_changed,
        'events', v_events
    );
END;
$$;


-- 4. Companion Stored Procedure wrapper for CALL syntax
CREATE OR REPLACE PROCEDURE pr_ingest_fhir_payload(
    IN p_payload JSONB,
    INOUT p_result JSONB DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
BEGIN
    p_result := sp_ingest_fhir_payload(p_payload);
END;
$$;

