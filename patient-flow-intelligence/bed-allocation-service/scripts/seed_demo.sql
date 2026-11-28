-- Repeatable local demo data for bed-allocation-service.
-- This creates only synthetic patients, waiting encounters, and available beds.
-- It does not create location allocations or modify existing hospital data.
DO $$
DECLARE
    demo_service_id uuid;
    demo_room_id uuid;
BEGIN
    SELECT id INTO demo_service_id FROM clinical_services ORDER BY id LIMIT 1;
    SELECT id INTO demo_room_id FROM rooms ORDER BY id LIMIT 1;

    IF demo_service_id IS NULL OR demo_room_id IS NULL THEN
        RAISE EXCEPTION 'A clinical service and room must exist before seeding demo data';
    END IF;

    INSERT INTO beds (id, code, room_id, status, version, status_reason)
    VALUES
        ('10000000-0000-0000-0000-000000000001', 'DEMO-BA-01', demo_room_id, 'AVAILABLE', 0, NULL),
        ('10000000-0000-0000-0000-000000000002', 'DEMO-BA-02', demo_room_id, 'AVAILABLE', 0, NULL),
        ('10000000-0000-0000-0000-000000000003', 'DEMO-BA-03', demo_room_id, 'AVAILABLE', 0, NULL)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO patients (id, sns_number, hospital_number, full_name, birth_date, gender, version)
    VALUES
        ('20000000-0000-0000-0000-000000000001', 'DEMO-SNS-001', 'DEMO-HN-001', 'Ana Martins', '1985-04-12', 'F', 0),
        ('20000000-0000-0000-0000-000000000002', 'DEMO-SNS-002', 'DEMO-HN-002', 'Bruno Silva', '1972-09-28', 'M', 0),
        ('20000000-0000-0000-0000-000000000003', 'DEMO-SNS-003', 'DEMO-HN-003', 'Carla Costa', '1993-01-19', 'F', 0)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO encounters (
        id, visit_number, patient_id, status, start_period, end_period, version,
        expected_discharge_at, clinical_discharge_at, service_id
    )
    VALUES
        ('30000000-0000-0000-0000-000000000001', 'DEMO-ENC-001',
         '20000000-0000-0000-0000-000000000001', 'IN_PROGRESS', now(), NULL, 0,
         now() + interval '3 days', NULL, demo_service_id),
        ('30000000-0000-0000-0000-000000000002', 'DEMO-ENC-002',
         '20000000-0000-0000-0000-000000000002', 'IN_PROGRESS', now(), NULL, 0,
         now() + interval '5 days', NULL, demo_service_id),
        ('30000000-0000-0000-0000-000000000003', 'DEMO-ENC-003',
         '20000000-0000-0000-0000-000000000003', 'IN_PROGRESS', now(), NULL, 0,
         now() + interval '7 days', NULL, demo_service_id)
    ON CONFLICT (id) DO NOTHING;
END $$;
