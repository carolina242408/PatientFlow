package com.projinf.patientflow.web;

import java.util.List;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class AccountResource {

    public record Account(String login, String name, String email, List<String> roles) {}

    /** Utilizador autenticado, lido do token Keycloak. */
    @GetMapping("/account")
    public Account getAccount(Authentication authentication) {
        Jwt jwt = (Jwt) authentication.getPrincipal();
        return new Account(
            jwt.getClaimAsString("preferred_username"),
            jwt.getClaimAsString("name"),
            jwt.getClaimAsString("email"),
            authentication.getAuthorities().stream().map(GrantedAuthority::getAuthority).toList());
    }
}
