package com.projinf.patientflow.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.projinf.patientflow.repository.HierarchyRepository.Type;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

class AccessPolicyTest {
    private final AccessPolicy policy = new AccessPolicy(mock(NamedParameterJdbcTemplate.class));

    @AfterEach
    void clearAuthentication() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void identityUsesOnlyTheMostSpecificGroupLevel() {
        UUID uls = UUID.fromString("00000000-0000-0000-0000-000000000001");
        UUID service = UUID.fromString("00000000-0000-0000-0000-000000000002");
        UUID ward = UUID.fromString("00000000-0000-0000-0000-000000000003");
        authenticate(List.of(
            "/ULS_North__" + uls,
            "/ULS_North__" + uls + "/SERVICE_Cardiology__" + service,
            "/ULS_North__" + uls + "/SERVICE_Cardiology__" + service + "/WARD_A__" + ward));

        AccessIdentity identity = policy.identity();

        assertThat(identity.scopeType()).isEqualTo(Type.WARD);
        assertThat(identity.scopeIds()).containsExactly(ward);
        assertThat(identity.manager()).isTrue();
    }

    @Test
    void identityPrefersWingOverServiceAndBroaderLevels() {
        UUID service = UUID.fromString("00000000-0000-0000-0000-000000000002");
        UUID wing = UUID.fromString("00000000-0000-0000-0000-000000000004");
        authenticate(List.of(
            "/UNIT_Centre__00000000-0000-0000-0000-000000000001",
            "/SERVICE_Cardiology__" + service,
            "/SERVICE_Cardiology__" + service + "/WING_East__" + wing));

        AccessIdentity identity = policy.identity();

        assertThat(identity.scopeType()).isEqualTo(Type.WING);
        assertThat(identity.scopeIds()).containsExactly(wing);
    }

    private void authenticate(List<String> groups) {
        Jwt jwt = Jwt.withTokenValue("token").header("alg", "none").subject("manager")
            .claim("groups", groups).build();
        var authentication = new JwtAuthenticationToken(jwt, List.of(new SimpleGrantedAuthority("MANAGER")));
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
    }
}
