package com.projinf.patientflow.security;

import com.projinf.patientflow.repository.HierarchyRepository.Type;
import com.projinf.patientflow.dto.ParsedBundleDTO;
import com.projinf.patientflow.exception.ResourceNotFoundException;
import java.util.*;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;

@Component
public class AccessPolicy {
    private final NamedParameterJdbcTemplate jdbc;
    public AccessPolicy(NamedParameterJdbcTemplate jdbc) { this.jdbc = jdbc; }

    public AccessIdentity identity() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || !(auth.getPrincipal() instanceof Jwt jwt)
                || jwt.getSubject() == null || jwt.getSubject().isBlank()) throw new AccessDeniedException("Identidade Keycloak obrigatória");
        Set<String> roles = new HashSet<>();
        auth.getAuthorities().forEach(a -> roles.add(a.getAuthority()));
        return new AccessIdentity(jwt.getSubject(), roles, jwt.getExpiresAt());
    }

    public void admin() {
        if (!identity().admin()) throw new AccessDeniedException("Operação reservada ao administrador");
    }

    public boolean operational(AccessIdentity identity) {
        if (identity.admin()) return true;
        return jdbc.queryForObject("SELECT count(*) FROM user_scope_grants g WHERE g.keycloak_subject=:authSubject AND "
            + "((g.scope_type='ULS' AND :authLhu) OR (g.scope_type='UNIT' AND :authUnit) OR (g.scope_type='SERVICE' AND :authService))",
            bindings(identity), Long.class) > 0;
    }

    public Map<String, Object> parameters() {
        var identity = identity();
        if (!operational(identity)) throw new AccessDeniedException("Sem papel e âmbito organizacional atribuídos");
        return new HashMap<>(bindings(identity));
    }

    public Map<String, Object> bindings(AccessIdentity identity) {
        return Map.of("authSubject", identity.subject(), "authAdmin", identity.admin(),
            "authLhu", identity.roles().contains("LHU_MANAGER"), "authUnit", identity.roles().contains("UNIT_MANAGER"),
            "authService", identity.roles().contains("SERVICE_MANAGER"));
    }

    public String sql(String uls, String unit, String service) {
        return "(:authAdmin OR EXISTS (SELECT 1 FROM user_scope_grants ag WHERE ag.keycloak_subject=:authSubject AND ("
            + "(:authLhu AND ag.scope_type='ULS' AND ag.uls_id=" + uls + ") OR "
            + "(:authUnit AND ag.scope_type='UNIT' AND ag.unit_id=" + unit + ") OR "
            + "(:authService AND ag.scope_type='SERVICE' AND ag.service_id=" + service + "))))";
    }

    public String patientSql(String patientId) {
        return "(:authAdmin OR EXISTS (SELECT 1 FROM encounters ae JOIN clinical_services aps ON aps.id=ae.service_id"
            + " JOIN healthcare_units apu ON apu.id=aps.unit_id WHERE ae.patient_id=" + patientId
            + " AND " + sql("apu.uls_id", "apu.id", "aps.id") + ") OR EXISTS (SELECT 1 FROM admission_requests aq"
            + " JOIN clinical_services aqs ON aqs.id=aq.service_id JOIN healthcare_units aqu ON aqu.id=aqs.unit_id"
            + " WHERE aq.patient_id=" + patientId + " AND " + sql("aqu.uls_id", "aqu.id", "aqs.id") + "))";
    }

    public String hierarchySql(Type type, String id) {
        String permitted = sql("os.uls_id", "os.unit_id", "os.service_id");
        if (type == Type.ULS || type == Type.UNIT) {
            String link = type == Type.ULS ? "child.uls_id=os.id" : "child.unit_id=os.id";
            permitted += " OR EXISTS (SELECT 1 FROM organization_scope child WHERE child.kind='SERVICE' AND " + link
                + " AND " + sql("child.uls_id", "child.unit_id", "child.service_id") + ")";
        } else if (type == Type.BUILDING || type == Type.FLOOR || type == Type.WING) {
            String column = type.name().toLowerCase(Locale.ROOT) + "_id";
            permitted += " OR EXISTS (SELECT 1 FROM organization_scope child WHERE child.kind='WARD' AND child."
                + column + "=os.id AND " + sql("child.uls_id", "child.unit_id", "child.service_id") + ")";
        }
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
            + " LEFT JOIN healthcare_units u ON u.id=s.unit_id WHERE e.id=:id AND "
            + sql("u.uls_id", "u.id", "s.id"), params, Long.class) == 0) {
            throw new ResourceNotFoundException("Episódio não encontrado no âmbito autorizado");
        }
    }

    public void ingestion(ParsedBundleDTO bundle) {
        var params = parameters();
        params.put("ward", bundle.location().wardCode()); params.put("room", bundle.location().roomCode());
        params.put("bed", bundle.location().bedCode());
        long count = jdbc.queryForObject("SELECT count(*) FROM beds b JOIN rooms r ON r.id=b.room_id"
            + " JOIN wards w ON w.id=r.ward_id JOIN clinical_services s ON s.id=w.service_id"
            + " JOIN healthcare_units u ON u.id=s.unit_id WHERE w.code=:ward AND r.code=:room AND b.code=:bed AND "
            + sql("u.uls_id", "u.id", "s.id"), params, Long.class);
        if (count == 0) throw new ResourceNotFoundException("Cama não encontrada no âmbito autorizado");
        var existing = jdbc.query("SELECT id FROM encounters WHERE visit_number=:visit",
            Map.of("visit", bundle.encounter().getVisitNumber()), (r, n) -> r.getObject(1, UUID.class));
        if (!existing.isEmpty()) encounter(existing.getFirst());
    }
}
