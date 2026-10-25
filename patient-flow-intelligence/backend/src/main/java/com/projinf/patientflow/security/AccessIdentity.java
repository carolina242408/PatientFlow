package com.projinf.patientflow.security;

import java.time.Instant;
import java.util.Set;

/** A websocket retains identity and expiry, never a bearer token. */
public record AccessIdentity(String subject, Set<String> roles, Instant expiresAt) {
    public AccessIdentity { roles = Set.copyOf(roles); }
    public boolean admin() { return roles.contains("ROLE_ADMIN"); }
}
