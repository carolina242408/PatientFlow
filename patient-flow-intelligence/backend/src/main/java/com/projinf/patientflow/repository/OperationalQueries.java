package com.projinf.patientflow.repository;

import com.projinf.patientflow.domain.model.BedStatus;
import com.projinf.patientflow.domain.model.EncounterStatus;
import com.projinf.patientflow.dto.OperationalDTO.*;
import com.projinf.patientflow.exception.ResourceNotFoundException;
import com.projinf.patientflow.security.AccessPolicy;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.*;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
@Transactional(readOnly = true)
public class OperationalQueries {
    private final NamedParameterJdbcTemplate jdbc;
    private final AccessPolicy access;
    public OperationalQueries(NamedParameterJdbcTemplate jdbc, AccessPolicy access) { this.jdbc = jdbc; this.access = access; }

    private static final String LOCATION = """
        LEFT JOIN rooms r ON r.id=b.room_id LEFT JOIN wards w ON w.id=r.ward_id
        LEFT JOIN wings wi ON wi.id=w.wing_id
        LEFT JOIN floors f ON f.id=(SELECT s_floor.floor_id FROM clinical_services s_floor
            WHERE s_floor.id=wi.service_id)
        LEFT JOIN buildings bu ON bu.id=f.building_id LEFT JOIN healthcare_units u ON u.id=bu.unit_id
        """;
    private static final String BED_FROM = " FROM beds b " + LOCATION + """
        JOIN uls l ON l.id=u.uls_id JOIN clinical_services s ON s.id=wi.service_id
        LEFT JOIN location_allocations a ON a.bed_id=b.id AND a.discharged_at IS NULL
        LEFT JOIN encounters e ON e.id=a.encounter_id LEFT JOIN patients p ON p.id=e.patient_id
        """;
    private static final String BED_SELECT = """
        SELECT b.id, b.code, b.status, b.status_reason, b.version, u.uls_id, l.name AS uls_name,
        u.id AS unit_id, u.name AS unit_name, s.id AS service_id, s.name AS service_name,
        w.id AS ward_id, w.code AS ward_code, r.id AS room_id, r.code AS room_code,
        p.id AS patient_id, p.full_name AS patient_name, p.birth_date AS patient_birth_date,
        e.id AS encounter_id, e.start_period AS admitted_at,
        e.expected_discharge_at, e.clinical_discharge_at
        """;
    private static final String ENCOUNTER_FROM = """
        FROM encounters e JOIN patients p ON p.id=e.patient_id
        LEFT JOIN LATERAL (SELECT * FROM location_allocations la WHERE la.encounter_id=e.id
            ORDER BY la.assigned_at DESC, la.id DESC LIMIT 1) a ON true
        LEFT JOIN beds b ON b.id=a.bed_id
        """ + LOCATION + " LEFT JOIN clinical_services s ON s.id=COALESCE(e.service_id,wi.service_id) ";
    private static final String ENCOUNTER_SELECT = """
        SELECT e.*, p.full_name AS patient_name, s.name AS service_name, b.id AS bed_id,
        b.code AS bed_code, w.id AS ward_id, w.code AS ward_code
        """;
    private static final String REQUEST_FROM = """
        FROM admission_requests q JOIN patients p ON p.id=q.patient_id
        JOIN clinical_services s ON s.id=q.service_id
        JOIN floors f ON f.id=s.floor_id
        JOIN buildings bu ON bu.id=f.building_id
        JOIN healthcare_units u ON u.id=bu.unit_id
        """;
    private static final String REQUEST_SELECT = "SELECT q.*, p.full_name AS patient_name, s.name AS service_name ";

    private Map<String, Object> params(Scope scope) {
        Map<String, Object> values = new HashMap<>(access.parameters());
        if (scope.ulsId() != null) values.put("uls", scope.ulsId());
        if (scope.unitId() != null) values.put("unit", scope.unitId());
        if (scope.buildingId() != null) values.put("building", scope.buildingId());
        if (scope.floorId() != null) values.put("floor", scope.floorId());
        if (scope.serviceId() != null) values.put("service", scope.serviceId());
        if (scope.wingId() != null) values.put("wing", scope.wingId());
        if (scope.wardId() != null) values.put("ward", scope.wardId());
        if (scope.roomId() != null) values.put("room", scope.roomId());
        return values;
    }

    private String scope(Scope scope) {
        return scope(scope, true);
    }

    private String scope(Scope scope, boolean hasWardLocation) {
        return " AND " + access.sql("u.uls_id", "u.id", "bu.id", "f.id", "s.id",
            hasWardLocation ? "wi.id" : null, hasWardLocation ? "w.id" : null)
            + (scope.ulsId() == null ? "" : " AND u.uls_id=:uls")
            + (scope.unitId() == null ? "" : " AND u.id=:unit")
        + (scope.buildingId() == null ? "" : " AND bu.id=:building")
        + (scope.floorId() == null ? "" : " AND f.id=:floor")
        + (scope.serviceId() == null ? "" : " AND s.id=:service")
        + (scope.wingId() == null ? "" : " AND wi.id=:wing")
        + (scope.wardId() == null ? "" : " AND w.id=:ward")
        + (scope.roomId() == null ? "" : " AND r.id=:room");
    }

    private <T> PageResult<T> page(String select, String from, String where, Map<String, Object> params,
            String order, int page, int size, RowMapper<T> mapper) {
        HierarchyRepository.page(page, size);
        long total = jdbc.queryForObject("SELECT count(*) " + from + where, params, Long.class);
        params.put("limit", size); params.put("offset", (long) page * size);
        var rows = jdbc.query(select + from + where + " ORDER BY " + order + " LIMIT :limit OFFSET :offset", params, mapper);
        return new PageResult<>(rows, page, size, total, (total + size - 1) / size);
    }

    private <T> T one(String query, UUID id, RowMapper<T> mapper) {
        var params = access.parameters(); params.put("id", id);
        return jdbc.query(query, params, mapper).stream().findFirst()
            .orElseThrow(() -> new ResourceNotFoundException("Recurso não encontrado"));
    }

    public PageResult<BedView> beds(Scope filter, BedStatus status, int page, int size) {
        var params = params(filter);
        String where = " WHERE 1=1" + scope(filter);
        if (status != null) { where += " AND b.status=:status"; params.put("status", status.name()); }
        return page(BED_SELECT, BED_FROM, where, params, "u.name, w.code, r.code, b.code, b.id", page, size, bedMapper);
    }

    public BedView bed(UUID id) { return one(BED_SELECT + BED_FROM + " WHERE b.id=:id AND "
        + access.sql("u.uls_id", "u.id", "bu.id", "f.id", "s.id", "wi.id", "w.id"), id, bedMapper); }

    public BedMap bedMap(Scope filter, BedStatus status, int page, int size) {
        Map<BedStatus, Long> counts = new EnumMap<>(BedStatus.class);
        for (BedStatus state : BedStatus.values()) counts.put(state, 0L);
        jdbc.query("SELECT b.status, count(*) AS total" + BED_FROM + " WHERE 1=1" + scope(filter)
            + " GROUP BY b.status", params(filter), r -> { counts.put(BedStatus.valueOf(r.getString("status")), r.getLong("total")); });
        return new BedMap(beds(filter, status, page, size), counts);
    }

    public PageResult<PatientView> patients(Scope filter, String search, int page, int size) {
        var params = params(filter);
        String where = " WHERE " + access.patientSql("p.id");
        if (search != null && !search.isBlank()) {
            if (search.length() > 255) throw new IllegalArgumentException("Pesquisa demasiado longa");
            where += " AND position(lower(:search) in lower(p.full_name || ' ' || p.sns_number)) > 0";
            params.put("search", search.trim());
        }
        if (filter.ulsId()!=null || filter.unitId()!=null || filter.serviceId()!=null || filter.wardId()!=null) {
            where += " AND (EXISTS (SELECT 1 FROM encounters e JOIN location_allocations a ON a.encounter_id=e.id"
                + " JOIN beds b ON b.id=a.bed_id " + LOCATION
                + " LEFT JOIN clinical_services s ON s.id=COALESCE(e.service_id,wi.service_id)"
                + " WHERE e.patient_id=p.id" + scope(filter) + ")";
            if (filter.wardId() == null) {
                where += " OR EXISTS (SELECT 1 FROM admission_requests q JOIN clinical_services s ON s.id=q.service_id"
                    + " JOIN floors f ON f.id=s.floor_id JOIN buildings bu ON bu.id=f.building_id"
                    + " JOIN healthcare_units u ON u.id=bu.unit_id WHERE q.patient_id=p.id" + scope(filter) + ")";
            }
            where += ")";
        }
        return page("SELECT p.*", " FROM patients p", where, params, "p.full_name, p.id", page, size, patientMapper);
    }

    public PatientView patient(UUID id) { return one("SELECT * FROM patients p WHERE p.id=:id AND " + access.patientSql("p.id"), id, patientMapper); }

    public PageResult<EncounterView> encounters(Scope filter, EncounterStatus status, UUID patientId, int page, int size) {
        var params = params(filter);
        String where = " WHERE 1=1" + scope(filter);
        if (status != null) { where += " AND e.status=:status"; params.put("status", status.name()); }
        if (patientId != null) { where += " AND e.patient_id=:patient"; params.put("patient", patientId); }
        return page(ENCOUNTER_SELECT, ENCOUNTER_FROM, where, params, "e.start_period DESC NULLS LAST, e.id", page, size, encounterMapper);
    }

    public EncounterView encounter(UUID id) { return one(ENCOUNTER_SELECT + ENCOUNTER_FROM + " WHERE e.id=:id AND "
        + access.sql("u.uls_id", "u.id", "bu.id", "f.id", "s.id", "wi.id", "w.id"), id, encounterMapper); }

    public PageResult<AllocationView> allocations(Scope filter, UUID bedId, UUID encounterId, UUID patientId,
            Boolean active, int page, int size) {
        var params = params(filter);
        String where = " WHERE 1=1" + scope(filter);
        if (bedId != null) { where += " AND b.id=:bed"; params.put("bed", bedId); }
        if (encounterId != null) { where += " AND e.id=:encounter"; params.put("encounter", encounterId); }
        if (patientId != null) { where += " AND e.patient_id=:patient"; params.put("patient", patientId); }
        if (active != null) where += " AND a.discharged_at IS " + (active ? "NULL" : "NOT NULL");
        String from = " FROM location_allocations a JOIN encounters e ON e.id=a.encounter_id JOIN beds b ON b.id=a.bed_id "
            + LOCATION + " LEFT JOIN clinical_services s ON s.id=COALESCE(e.service_id,wi.service_id) ";
        return page("SELECT a.*, e.visit_number, e.patient_id, b.code AS bed_code, w.id AS ward_id", from, where,
            params, "a.assigned_at DESC, a.id", page, size, (r, n) -> new AllocationView(uuid(r, "id"),
                uuid(r, "encounter_id"), r.getString("visit_number"), uuid(r, "patient_id"), uuid(r, "bed_id"),
                r.getString("bed_code"), uuid(r, "ward_id"), instant(r, "assigned_at"), instant(r, "discharged_at")));
    }

    public PageResult<AdmissionRequestView> requests(Scope filter, RequestStatus status, AdmissionOrigin origin,
            int page, int size) {
        if (filter.wardId() != null) throw new IllegalArgumentException("Pedidos em espera não têm enfermaria atribuída");
        var params = params(filter);
        String where = " WHERE 1=1" + scope(filter, false);
        if (status != null) { where += " AND q.status=:status"; params.put("status", status.name()); }
        if (origin != null) { where += " AND q.origin=:origin"; params.put("origin", origin.name()); }
        return page(REQUEST_SELECT, REQUEST_FROM, where, params, "q.priority, q.requested_at, q.id", page, size, requestMapper);
    }

    public AdmissionRequestView request(UUID id) { return one(REQUEST_SELECT + REQUEST_FROM + " WHERE q.id=:id AND "
        + access.sql("u.uls_id", "u.id", "bu.id", "f.id", "s.id", null, null), id, requestMapper); }

    private static UUID uuid(ResultSet r, String field) throws SQLException { return r.getObject(field, UUID.class); }
    private static Instant instant(ResultSet r, String field) throws SQLException {
        var value = r.getObject(field, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
    private static final RowMapper<PatientView> patientMapper = (r, n) -> new PatientView(uuid(r, "id"),
        r.getString("sns_number"), r.getString("full_name"), r.getString("hospital_number"),
        r.getObject("birth_date", LocalDate.class), r.getString("gender"), r.getLong("version"));
    private static final RowMapper<BedView> bedMapper = (r, n) -> new BedView(uuid(r, "id"), r.getString("code"),
        BedStatus.valueOf(r.getString("status")), r.getString("status_reason"), r.getLong("version"),
        uuid(r, "uls_id"), r.getString("uls_name"), uuid(r, "unit_id"), r.getString("unit_name"),
        uuid(r, "service_id"), r.getString("service_name"), uuid(r, "ward_id"), r.getString("ward_code"),
        uuid(r, "room_id"), r.getString("room_code"), uuid(r, "patient_id"), r.getString("patient_name"),
        r.getObject("patient_birth_date", LocalDate.class), uuid(r, "encounter_id"),
        instant(r, "admitted_at"), instant(r, "expected_discharge_at"), instant(r, "clinical_discharge_at"));
    private static final RowMapper<EncounterView> encounterMapper = (r, n) -> new EncounterView(uuid(r, "id"),
        r.getString("visit_number"), uuid(r, "patient_id"), r.getString("patient_name"), r.getString("status"),
        instant(r, "start_period"), instant(r, "expected_discharge_at"), instant(r, "clinical_discharge_at"),
        instant(r, "end_period"), uuid(r, "service_id"), r.getString("service_name"), uuid(r, "bed_id"),
        r.getString("bed_code"), uuid(r, "ward_id"), r.getString("ward_code"), r.getLong("version"));
    private static final RowMapper<AdmissionRequestView> requestMapper = (r, n) -> new AdmissionRequestView(uuid(r, "id"),
        r.getString("request_number"), uuid(r, "patient_id"), r.getString("patient_name"), uuid(r, "service_id"),
        r.getString("service_name"), AdmissionOrigin.valueOf(r.getString("origin")), r.getInt("priority"),
        instant(r, "requested_at"), instant(r, "desired_admission_at"), RequestStatus.valueOf(r.getString("status")),
        uuid(r, "encounter_id"), instant(r, "closed_at"), r.getLong("version"));
}
