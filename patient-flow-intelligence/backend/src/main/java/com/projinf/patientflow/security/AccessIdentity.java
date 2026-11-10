package com.projinf.patientflow.security;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import com.projinf.patientflow.repository.HierarchyRepository.Type;

/** A websocket retains identity and expiry, never a bearer token. */
public record AccessIdentity(String subject, Set<String> roles, Instant expiresAt,
        Type scopeType, Set<UUID> scopeIds) {
    public AccessIdentity {
        roles = Set.copyOf(roles);
        scopeIds = Set.copyOf(scopeIds);
    }
    public boolean admin() { return roles.contains("ROLE_ADMIN"); }
    public boolean manager() { return roles.contains("MANAGER"); }
}
