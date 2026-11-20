package com.projinf.patientflow.security;

import jakarta.validation.constraints.*;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.*;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import com.projinf.patientflow.event.ChangePublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.projinf.patientflow.exception.ResourceNotFoundException;

@Service
public class ScopeGrantService {
    private final ChangePublisher changes;
    public enum Kind { ULS, UNIT, BUILDING, FLOOR, SERVICE, WING, WARD }
    public record GrantInput(@NotBlank @Size(max=255) String subject, @NotNull Kind type, @NotNull UUID scopeId) { }
    public record Grant(UUID id, String subject, Kind type, UUID scopeId, String grantedBy, Instant grantedAt) { }
    public record AccessSummary(String subject, Set<String> roles, boolean administrator, List<Grant> scopes) { }
    private final NamedParameterJdbcTemplate jdbc;
    private final AccessPolicy access;
    public ScopeGrantService(NamedParameterJdbcTemplate jdbc, AccessPolicy access, ChangePublisher changes) {
        this.changes=changes; this.jdbc=jdbc; this.access=access; }

    public AccessSummary me() {
        var identity=access.identity();
        var effective = new ArrayList<Grant>();
        if (identity.scopeType() != null) {
            Kind type = Kind.valueOf(identity.scopeType().name());
            identity.scopeIds().forEach(id -> effective.add(new Grant(UUID.randomUUID(), identity.subject(),
                type, id, "KEYCLOAK_GROUP", Instant.EPOCH)));
        }
        return new AccessSummary(identity.subject(), identity.roles(), identity.admin(), effective);
    }

    public List<Grant> list(String subject) { access.admin(); return listFor(subject); }
    private List<Grant> listFor(String subject) {
        // Subjects are exact Keycloak sub values. No username-based automatic grants.
        return jdbc.query("SELECT * FROM user_scope_grants" + (subject==null ? "" : " WHERE keycloak_subject=:subject")
            + " ORDER BY granted_at,id", subject==null ? Map.of() : Map.of("subject", subject), (r,n) -> new Grant(
                r.getObject("id",UUID.class),r.getString("keycloak_subject"),Kind.valueOf(r.getString("scope_type")),
                r.getObject(r.getString("scope_type").toLowerCase(Locale.ROOT)+"_id",UUID.class),r.getString("granted_by"),
                r.getObject("granted_at",OffsetDateTime.class).toInstant()));
    }

    @Transactional
    public Grant create(GrantInput input) {
        access.admin();
        String table=switch(input.type()) {
            case ULS -> "uls";
            case UNIT -> "healthcare_units";
            case SERVICE -> "clinical_services";
            case BUILDING, FLOOR, WING, WARD ->
                throw new IllegalArgumentException("Este tipo de âmbito é gerido através de grupos Keycloak");
        };
        if(jdbc.queryForObject("SELECT count(*) FROM "+table+" WHERE id=:id",Map.of("id",input.scopeId()),Long.class)==0)
            throw new ResourceNotFoundException("Âmbito organizacional não encontrado");
        UUID id=UUID.randomUUID();
        String subject=input.subject().trim();
        jdbc.update("INSERT INTO user_scope_grants(id,keycloak_subject,scope_type,"+input.type().name().toLowerCase(Locale.ROOT)
            +"_id,granted_by,granted_at) VALUES(:id,:subject,:type,:scope,:actor,CURRENT_TIMESTAMP)",
            Map.of("id",id,"subject",subject,"type",input.type().name(),"scope",input.scopeId(),"actor",access.identity().subject()));
        changes.accessChanged(subject,id);
        return listFor(subject).stream().filter(g->g.id().equals(id)).findFirst().orElseThrow();
    }

    @Transactional
    public void delete(UUID id) {
        access.admin();
        var subjects=jdbc.query("DELETE FROM user_scope_grants WHERE id=:id RETURNING keycloak_subject",Map.of("id",id),
            (r,n)->r.getString(1));
        if(subjects.isEmpty()) throw new ResourceNotFoundException("Associação de acesso não encontrada");
        changes.accessChanged(subjects.getFirst(),id);
    }
}
