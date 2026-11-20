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
    private static final Pattern GROUP_ID = Pattern.compile(
        "^(ULS|UNIT|BUILDING|FLOOR|SERVICE|WING|WARD)_[^/]*__"
            + "([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$");
    private static final List<Type> SCOPE_PRECEDENCE =
        List.of(Type.WARD, Type.WING, Type.SERVICE, Type.FLOOR, Type.BUILDING, Type.UNIT, Type.ULS);
    private final NamedParameterJdbcTemplate jdbc;
    public AccessPolicy(NamedParameterJdbcTemplate jdbc) { this.jdbc = jdbc; }

    public AccessIdentity identity() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || !(auth.getPrincipal() instanceof Jwt jwt)
                || jwt.getSubject() == null || jwt.getSubject().isBlank()) throw new AccessDeniedException("Identidade Keycloak obrigatória");
        Set<String> roles = new HashSet<>();
        auth.getAuthorities().forEach(a -> roles.add(a.getAuthority()));
        Map<Type, Set<UUID>> scopes = new EnumMap<>(Type.class);
        Object claim = jwt.getClaims().get("groups");
        if (claim instanceof Collection<?> groups) {
            for (Object value : groups) {
                String path = String.valueOf(value);
                for (String segment : path.split("/")) {
                    Matcher match = GROUP_ID.matcher(segment);
                    if (!match.matches()) continue;
                    Type type = Type.valueOf(match.group(1));
                    if (type.supportsKeycloakGroup()) {
                        scopes.computeIfAbsent(type, ignored -> new HashSet<>())
                            .add(UUID.fromString(match.group(2)));
                    }
                }
            }
        }
        Type scopeType = SCOPE_PRECEDENCE.stream().filter(scopes::containsKey).findFirst().orElse(null);
        Set<UUID> scopeIds = scopeType == null ? Set.of() : scopes.get(scopeType);
        return new AccessIdentity(jwt.getSubject(), roles, jwt.getExpiresAt(), scopeType, scopeIds);
    }

    public void admin() {
        if (!identity().admin()) throw new AccessDeniedException("Operação reservada ao administrador");
    }

    public boolean operational(AccessIdentity identity) {
        if (identity.admin()) return true;
        if (!identity.manager() || identity.scopeType() == null || identity.scopeIds().isEmpty()) return false;
        var params = bindings(identity);
        return jdbc.queryForObject("SELECT count(*) FROM organization_scope os "
            + "WHERE os.kind=:authScopeType AND os.id IN (:authScopeIds)", params, Long.class) > 0;
    }

    public Map<String, Object> parameters() {
        var identity = identity();
        if (!operational(identity)) throw new AccessDeniedException("Sem papel e âmbito organizacional atribuídos");
        return new HashMap<>(bindings(identity));
    }

    public Map<String, Object> bindings(AccessIdentity identity) {
        Set<UUID> scopeIds = identity.scopeIds().isEmpty()
                ? Set.of(new UUID(0L, 0L)) : identity.scopeIds();
        return Map.of("authSubject", identity.subject(), "authAdmin", identity.admin(),
            "authManager", identity.manager(),
            "authScopeType", identity.scopeType() == null ? "" : identity.scopeType().name(),
            "authScopeIds", scopeIds);
    }

    public String sql(String uls, String unit, String service) {
        return sql(identity(), uls, unit, null, null, service, null, null);
    }

    public String sql(String uls, String unit, String building, String floor,
            String service, String wing, String ward) {
        return sql(identity(), uls, unit, building, floor, service, wing, ward);
    }

    public String sql(AccessIdentity identity, String uls, String unit, String building,
            String floor, String service, String wing, String ward) {
        String scope = switch (identity.scopeType() == null ? Type.BED : identity.scopeType()) {
            case ULS -> uls;
            case UNIT -> unit;
            case BUILDING -> building;
            case FLOOR -> floor;
            case SERVICE -> service;
            case WING -> wing;
            case WARD -> ward;
            case ROOM, BED -> null;
        };
        if (scope == null && identity.scopeType() != null
                && (identity.scopeType() == Type.BUILDING || identity.scopeType() == Type.FLOOR)) {
            String column = identity.scopeType().name().toLowerCase(Locale.ROOT) + "_id";
            scope = "EXISTS (SELECT 1 FROM organization_scope access_scope "
                + "WHERE access_scope.kind='SERVICE' AND access_scope.service_id=" + service
                + " AND access_scope." + column + " IN (:authScopeIds))";
            return "(:authAdmin OR (:authManager AND " + scope + "))";
        }
        if (scope == null) return "(:authAdmin)";
        return "(:authAdmin OR (:authManager AND " + scope + " IN (:authScopeIds)))";
    }

    public String patientSql(String patientId) {
        return "(:authAdmin OR EXISTS (SELECT 1 FROM encounters ae"
            + " LEFT JOIN clinical_services direct_service ON direct_service.id=ae.service_id"
            + " LEFT JOIN location_allocations active_allocation ON active_allocation.encounter_id=ae.id"
            + " AND active_allocation.discharged_at IS NULL"
            + " LEFT JOIN beds active_bed ON active_bed.id=active_allocation.bed_id"
            + " LEFT JOIN rooms active_room ON active_room.id=active_bed.room_id"
            + " LEFT JOIN wards active_ward ON active_ward.id=active_room.ward_id"
            + " LEFT JOIN wings active_wing ON active_wing.id=active_ward.wing_id"
            + " LEFT JOIN clinical_services allocated_service ON allocated_service.id=active_wing.service_id"
            + " JOIN floors apf ON apf.id=COALESCE(direct_service.floor_id, allocated_service.floor_id)"
            + " JOIN buildings apb ON apb.id=apf.building_id"
            + " JOIN healthcare_units apu ON apu.id=apb.unit_id WHERE ae.patient_id=" + patientId
            + " AND " + sql(identity(), "apu.uls_id", "apu.id", "apb.id", "apf.id",
                "COALESCE(direct_service.id, allocated_service.id)", "active_wing.id", "active_ward.id")
            + ") OR EXISTS (SELECT 1 FROM admission_requests aq"
            + " JOIN clinical_services aqs ON aqs.id=aq.service_id JOIN floors aqf ON aqf.id=aqs.floor_id"
            + " JOIN buildings aqb ON aqb.id=aqf.building_id JOIN healthcare_units aqu ON aqu.id=aqb.unit_id"
            + " WHERE aq.patient_id=" + patientId + " AND " + sql("aqu.uls_id", "aqu.id", "aqs.id") + "))";
    }

    public String hierarchySql(Type type, String id) {
        Type scopeType = identity().scopeType();
        if (scopeType == null) return "(:authAdmin)";
        String scopeColumn = scopeColumn(scopeType);
        String targetColumn = scopeColumn(type);
        String permitted = "(:authAdmin OR (:authManager AND (os." + scopeColumn
            + " IN (:authScopeIds) OR EXISTS (SELECT 1 FROM organization_scope selected_scope "
            + "WHERE selected_scope.kind='" + scopeType.name() + "' AND selected_scope.id IN (:authScopeIds) "
            + "AND selected_scope." + targetColumn + "=os.id))))";
        return "EXISTS (SELECT 1 FROM organization_scope os WHERE os.kind='" + type.name() + "' AND os.id="
            + id + " AND (" + permitted + "))";
    }

    private static String scopeColumn(Type type) {
        return switch (type) {
            case ULS -> "uls_id";
            case UNIT -> "unit_id";
            case BUILDING -> "building_id";
            case FLOOR -> "floor_id";
            case SERVICE -> "service_id";
            case WING -> "wing_id";
            case WARD -> "ward_id";
            case ROOM -> "room_id";
            case BED -> "bed_id";
        };
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
        if (jdbc.queryForObject("""
            SELECT count(*) FROM encounters e
            LEFT JOIN LATERAL (SELECT bed_id FROM location_allocations la WHERE la.encounter_id=e.id
                ORDER BY la.assigned_at DESC,la.id DESC LIMIT 1) a ON true
            LEFT JOIN beds bed ON bed.id=a.bed_id
            LEFT JOIN rooms r ON r.id=bed.room_id
            LEFT JOIN wards w ON w.id=r.ward_id
            LEFT JOIN wings wi ON wi.id=w.wing_id
            LEFT JOIN clinical_services s ON s.id=COALESCE(e.service_id,wi.service_id)
            LEFT JOIN floors f ON f.id=s.floor_id
            LEFT JOIN buildings b ON b.id=f.building_id
            LEFT JOIN healthcare_units u ON u.id=b.unit_id
            WHERE e.id=:id AND
            """ + sql("u.uls_id", "u.id", "b.id", "f.id", "s.id", "wi.id", "w.id"),
            params, Long.class) == 0) {
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
            + sql("u.uls_id", "u.id", "bu.id", "f.id", "s.id", "wi.id", "w.id"), params, Long.class);
        if (count == 0) throw new ResourceNotFoundException("Cama não encontrada no âmbito autorizado");
        var existing = jdbc.query("SELECT id FROM encounters WHERE visit_number=:visit",
            Map.of("visit", bundle.encounter().getVisitNumber()), (r, n) -> r.getObject(1, UUID.class));
        if (!existing.isEmpty()) encounter(existing.getFirst());
    }
}
