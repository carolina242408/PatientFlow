package com.projinf.patientflow.security;

import com.projinf.patientflow.repository.HierarchyRepository.Type;
import com.projinf.patientflow.dto.ParsedBundleDTO;
import com.projinf.patientflow.exception.ResourceNotFoundException;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;

@Component
public class AccessPolicy {
    private static final Pattern GROUP_ID = Pattern.compile("^(ULS|UNIT|SERVICE)_[^/]*__([0-9a-fA-F-]{36})$");
    private final NamedParameterJdbcTemplate jdbc;
    public AccessPolicy(NamedParameterJdbcTemplate jdbc) { this.jdbc = jdbc; }

    public AccessIdentity identity() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || !(auth.getPrincipal() instanceof Jwt jwt)
                || jwt.getSubject() == null || jwt.getSubject().isBlank()) throw new AccessDeniedException("Identidade Keycloak obrigatória");
        Set<String> roles = new HashSet<>();
        auth.getAuthorities().forEach(a -> roles.add(a.getAuthority()));
        Set<UUID> uls = new HashSet<>(), units = new HashSet<>(), services = new HashSet<>();
        Object claim = jwt.getClaims().get("groups");
        if (claim instanceof Collection<?> groups) {
            for (Object value : groups) {
                String path = String.valueOf(value);
                for (String segment : path.split("/")) {
                    Matcher match = GROUP_ID.matcher(segment);
                    if (!match.matches()) continue;
                    UUID id = UUID.fromString(match.group(2));
                    switch (match.group(1)) {
                        case "ULS" -> uls.add(id);
                        case "UNIT" -> units.add(id);
                        case "SERVICE" -> services.add(id);
                        default -> { }
                    }
                }
            }
        }
        return new AccessIdentity(jwt.getSubject(), roles, jwt.getExpiresAt(), uls, units, services);
    }

    public void admin() {
        if (!identity().admin()) throw new AccessDeniedException("Operação reservada ao administrador");
    }

    public boolean operational(AccessIdentity identity) {
        if (identity.admin()) return true;
        return jdbc.queryForObject("SELECT count(*) FROM organization_scope os WHERE "
            + "(:authLhu AND os.uls_id IN (:authUlsIds)) OR "
            + "(:authUnit AND os.unit_id IN (:authUnitIds)) OR "
            + "(:authService AND os.service_id IN (:authServiceIds))", bindings(identity), Long.class) > 0;
    }

    public Map<String, Object> parameters() {
        var identity = identity();
        if (!operational(identity)) throw new AccessDeniedException("Sem papel e âmbito organizacional atribuídos");
        return new HashMap<>(bindings(identity));
    }

    public Map<String, Object> bindings(AccessIdentity identity) {
        Set<UUID> ulsIds = identity.ulsIds().isEmpty()
                ? Set.of(new UUID(0L, 0L)) : identity.ulsIds();
        Set<UUID> unitIds = identity.unitIds().isEmpty()
                ? Set.of(new UUID(0L, 0L)) : identity.unitIds();
        Set<UUID> serviceIds = identity.serviceIds().isEmpty()
                ? Set.of(new UUID(0L, 0L)) : identity.serviceIds();
        return Map.of("authSubject", identity.subject(), "authAdmin", identity.admin(),
            "authLhu", identity.roles().contains("LHU_MANAGER"), "authUnit", identity.roles().contains("UNIT_MANAGER"),
            "authService", identity.roles().contains("SERVICE_MANAGER"),
            "authUlsIds", ulsIds, "authUnitIds", unitIds, "authServiceIds", serviceIds);
    }

    public String sql(String uls, String unit, String service) {
        return "(:authAdmin OR ("
            + "(:authLhu AND " + uls + " IN (:authUlsIds)) OR "
            + "(:authUnit AND " + unit + " IN (:authUnitIds)) OR "
            + "(:authService AND " + service + " IN (:authServiceIds))))";
    }

    public String patientSql(String patientId) {
        return "(:authAdmin OR EXISTS (SELECT 1 FROM encounters ae JOIN clinical_services aps ON aps.id=ae.service_id"
            + " JOIN floors apf ON apf.id=aps.floor_id JOIN buildings apb ON apb.id=apf.building_id"
            + " JOIN healthcare_units apu ON apu.id=apb.unit_id WHERE ae.patient_id=" + patientId
            + " AND " + sql("apu.uls_id", "apu.id", "aps.id") + ") OR EXISTS (SELECT 1 FROM admission_requests aq"
            + " JOIN clinical_services aqs ON aqs.id=aq.service_id JOIN floors aqf ON aqf.id=aqs.floor_id"
            + " JOIN buildings aqb ON aqb.id=aqf.building_id JOIN healthcare_units aqu ON aqu.id=aqb.unit_id"
            + " WHERE aq.patient_id=" + patientId + " AND " + sql("aqu.uls_id", "aqu.id", "aqs.id") + "))";
    }

    public String hierarchySql(Type type, String id) {
        String permitted = switch (type) {
            case ULS -> "(:authAdmin OR (:authLhu AND os.uls_id IN (:authUlsIds)))";
            case UNIT, BUILDING, FLOOR ->
                "(:authAdmin OR (:authLhu AND os.uls_id IN (:authUlsIds))"
                + " OR (:authUnit AND os.unit_id IN (:authUnitIds)))";
            default -> sql("os.uls_id", "os.unit_id", "os.service_id");
        };
        return "EXISTS (SELECT 1 FROM organization_scope os WHERE os.kind='" + type.name() + "' AND os.id="
            + id + " AND (" + permitted + "))";
    }

    public void service(UUID id) { requireHierarchy(Type.SERVICE, id); }
    public void bed(UUID id) { requireHierarchy(Type.BED, id); }

    public void requireHierarchy(Type type, UUID id) {
        var params = parameters(); params.put("id", id);
        if (!jdbc.queryForObject("SELECT " + hierarchySql(type, ":id"), params, Boolean.class)) {
            throw new ResourceNotFoundException("Recurso não encontrado no âmbito autorizado");
        }
    }

    public void encounter(UUID id) {
        var params = parameters(); params.put("id", id);
        if (jdbc.queryForObject("SELECT count(*) FROM encounters e LEFT JOIN clinical_services s ON s.id=e.service_id"
            + " LEFT JOIN floors f ON f.id=s.floor_id LEFT JOIN buildings b ON b.id=f.building_id"
            + " LEFT JOIN healthcare_units u ON u.id=b.unit_id WHERE e.id=:id AND "
            + sql("u.uls_id", "u.id", "s.id"), params, Long.class) == 0) {
            throw new ResourceNotFoundException("Episódio não encontrado no âmbito autorizado");
        }
    }

    public void ingestion(ParsedBundleDTO bundle) {
        var params = parameters();
        params.put("ward", bundle.location().wardCode()); params.put("room", bundle.location().roomCode());
        params.put("bed", bundle.location().bedCode());
        long count = jdbc.queryForObject("SELECT count(*) FROM beds b JOIN rooms r ON r.id=b.room_id"
            + " JOIN wards w ON w.id=r.ward_id JOIN wings wi ON wi.id=w.wing_id"
            + " JOIN clinical_services s ON s.id=wi.service_id JOIN floors f ON f.id=s.floor_id"
            + " JOIN buildings bu ON bu.id=f.building_id JOIN healthcare_units u ON u.id=bu.unit_id"
            + " WHERE w.code=:ward AND r.code=:room AND b.code=:bed AND "
            + sql("u.uls_id", "u.id", "s.id"), params, Long.class);
        if (count == 0) throw new ResourceNotFoundException("Cama não encontrada no âmbito autorizado");
        var existing = jdbc.query("SELECT id FROM encounters WHERE visit_number=:visit",
            Map.of("visit", bundle.encounter().getVisitNumber()), (r, n) -> r.getObject(1, UUID.class));
        if (!existing.isEmpty()) encounter(existing.getFirst());
    }
}
