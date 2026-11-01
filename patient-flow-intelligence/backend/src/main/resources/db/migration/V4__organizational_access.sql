CREATE TABLE IF NOT EXISTS user_scope_grants (
    id UUID PRIMARY KEY,
    keycloak_subject VARCHAR(255) NOT NULL CHECK (btrim(keycloak_subject) <> ''),
    scope_type VARCHAR(16) NOT NULL CHECK (scope_type IN ('ULS','UNIT','SERVICE')),
    uls_id UUID REFERENCES uls(id),
    unit_id UUID REFERENCES healthcare_units(id),
    service_id UUID REFERENCES clinical_services(id),
    granted_by VARCHAR(255) NOT NULL,
    granted_at TIMESTAMP(6) WITH TIME ZONE NOT NULL,
    CHECK ((scope_type='ULS' AND uls_id IS NOT NULL AND unit_id IS NULL AND service_id IS NULL)
        OR (scope_type='UNIT' AND uls_id IS NULL AND unit_id IS NOT NULL AND service_id IS NULL)
        OR (scope_type='SERVICE' AND uls_id IS NULL AND unit_id IS NULL AND service_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_subject_uls ON user_scope_grants(keycloak_subject, uls_id) WHERE uls_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_subject_unit ON user_scope_grants(keycloak_subject, unit_id) WHERE unit_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_subject_service ON user_scope_grants(keycloak_subject, service_id) WHERE service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_scope_subject ON user_scope_grants(keycloak_subject);

-- 8. VIEW Organization Scope Atualizada para a nova Hierarquia
CREATE OR REPLACE VIEW organization_scope AS
SELECT l.id AS id, 'ULS' AS kind, l.id AS uls_id, NULL::uuid AS unit_id, NULL::uuid AS building_id, NULL::uuid AS floor_id, NULL::uuid AS service_id, NULL::uuid AS wing_id, NULL::uuid AS ward_id, NULL::uuid AS room_id, NULL::uuid AS bed_id FROM uls l
UNION ALL
SELECT u.id AS id, 'UNIT' AS kind, u.uls_id AS uls_id, u.id AS unit_id, NULL::uuid AS building_id, NULL::uuid AS floor_id, NULL::uuid AS service_id, NULL::uuid AS wing_id, NULL::uuid AS ward_id, NULL::uuid AS room_id, NULL::uuid AS bed_id FROM healthcare_units u
UNION ALL
SELECT b.id AS id, 'BUILDING' AS kind, u.uls_id AS uls_id, u.id AS unit_id, b.id AS building_id, NULL::uuid AS floor_id, NULL::uuid AS service_id, NULL::uuid AS wing_id, NULL::uuid AS ward_id, NULL::uuid AS room_id, NULL::uuid AS bed_id FROM buildings b JOIN healthcare_units u ON u.id=b.unit_id
UNION ALL
SELECT f.id AS id, 'FLOOR' AS kind, u.uls_id AS uls_id, u.id AS unit_id, b.id AS building_id, f.id AS floor_id, NULL::uuid AS service_id, NULL::uuid AS wing_id, NULL::uuid AS ward_id, NULL::uuid AS room_id, NULL::uuid AS bed_id FROM floors f JOIN buildings b ON b.id=f.building_id JOIN healthcare_units u ON u.id=b.unit_id
UNION ALL
SELECT s.id AS id, 'SERVICE' AS kind, u.uls_id AS uls_id, u.id AS unit_id, b.id AS building_id, f.id AS floor_id, s.id AS service_id, NULL::uuid AS wing_id, NULL::uuid AS ward_id, NULL::uuid AS room_id, NULL::uuid AS bed_id FROM clinical_services s JOIN floors f ON f.id=s.floor_id JOIN buildings b ON b.id=f.building_id JOIN healthcare_units u ON u.id=b.unit_id
UNION ALL
SELECT wi.id AS id, 'WING' AS kind, u.uls_id AS uls_id, u.id AS unit_id, b.id AS building_id, f.id AS floor_id, s.id AS service_id, wi.id AS wing_id, NULL::uuid AS ward_id, NULL::uuid AS room_id, NULL::uuid AS bed_id FROM wings wi JOIN clinical_services s ON s.id=wi.service_id JOIN floors f ON f.id=s.floor_id JOIN buildings b ON b.id=f.building_id JOIN healthcare_units u ON u.id=b.unit_id
UNION ALL
SELECT w.id AS id, 'WARD' AS kind, u.uls_id AS uls_id, u.id AS unit_id, b.id AS building_id, f.id AS floor_id, s.id AS service_id, wi.id AS wing_id, w.id AS ward_id, NULL::uuid AS room_id, NULL::uuid AS bed_id FROM wards w JOIN wings wi ON wi.id=w.wing_id JOIN clinical_services s ON s.id=wi.service_id JOIN floors f ON f.id=s.floor_id JOIN buildings b ON b.id=f.building_id JOIN healthcare_units u ON u.id=b.unit_id
UNION ALL
SELECT r.id AS id, 'ROOM' AS kind, u.uls_id AS uls_id, u.id AS unit_id, b.id AS building_id, f.id AS floor_id, s.id AS service_id, wi.id AS wing_id, w.id AS ward_id, r.id AS room_id, NULL::uuid AS bed_id FROM rooms r JOIN wards w ON w.id=r.ward_id JOIN wings wi ON wi.id=w.wing_id JOIN clinical_services s ON s.id=wi.service_id JOIN floors f ON f.id=s.floor_id JOIN buildings b ON b.id=f.building_id JOIN healthcare_units u ON u.id=b.unit_id
UNION ALL
SELECT bd.id AS id, 'BED' AS kind, u.uls_id AS uls_id, u.id AS unit_id, b.id AS building_id, f.id AS floor_id, s.id AS service_id, wi.id AS wing_id, w.id AS ward_id, r.id AS room_id, bd.id AS bed_id FROM beds bd JOIN rooms r ON r.id=bd.room_id JOIN wards w ON w.id=r.ward_id JOIN wings wi ON wi.id=w.wing_id JOIN clinical_services s ON s.id=wi.service_id JOIN floors f ON f.id=s.floor_id JOIN buildings b ON b.id=f.building_id JOIN healthcare_units u ON u.id=b.unit_id;