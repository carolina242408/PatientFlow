package com.projinf.patientflow.security;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

/** A websocket retains identity and expiry, never a bearer token. */
public record AccessIdentity(String subject, Set<String> roles, Instant expiresAt,
        Set<UUID> ulsIds, Set<UUID> unitIds, Set<UUID> serviceIds) {
    public AccessIdentity {
        roles = Set.copyOf(roles);
        ulsIds = Set.copyOf(ulsIds);
        unitIds = Set.copyOf(unitIds);
        serviceIds = Set.copyOf(serviceIds);
    }
    public boolean admin() { return roles.contains("ROLE_ADMIN"); }
}
