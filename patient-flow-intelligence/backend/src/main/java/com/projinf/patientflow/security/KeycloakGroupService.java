package com.projinf.patientflow.security;

import com.projinf.patientflow.repository.HierarchyRepository.Type;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.stereotype.Service;

/** Creates the organizational groups whose paths are carried by Keycloak tokens. */
@Service
public class KeycloakGroupService {
    private static final Pattern UNSAFE = Pattern.compile("[^\\p{L}\\p{N}]+");
    private final RestClient client;
    private final String realm;
    private final String username;
    private final String password;
    private final String clientId;
    private volatile Token token;

    public KeycloakGroupService(
            @Value("${patientflow.keycloak.admin-base-url:http://localhost:9080}") String baseUrl,
            @Value("${patientflow.keycloak.realm:patientflow}") String realm,
            @Value("${patientflow.keycloak.admin-username:}") String username,
            @Value("${patientflow.keycloak.admin-password:}") String password,
            @Value("${patientflow.keycloak.admin-client-id:admin-cli}") String clientId) {
        this.client = RestClient.builder().baseUrl(baseUrl).build();
        this.realm = realm;
        this.username = username;
        this.password = password;
        this.clientId = clientId;
    }

    public void ensureHierarchyGroup(Type type, UUID id, String name, UUID parentId) {
        if (!type.supportsKeycloakGroup()) return;

        String groupName = groupName(type, id, name);
        String parentGroupId = parentId == null ? null : findGroupId(parentId);
        if (parentId != null && parentGroupId == null) {
            throw new IllegalStateException("Grupo Keycloak pai não encontrado para " + parentId);
        }
        if (findChildGroupId(parentGroupId, groupName) == null) {
            createGroup(groupName, parentGroupId);
        }
    }

    public static String groupName(Type type, UUID id, String name) {
        String slug = UNSAFE.matcher(name.trim()).replaceAll("_").replaceAll("^_+|_+$", "");
        return type.name() + "_" + slug + "__" + id;
    }

    private String findGroupId(UUID id) {
        String marker = "__" + id;
        return findGroupId(groups(null), marker);
    }

    @SuppressWarnings("unchecked")
    private String findGroupId(List<Map<String, Object>> candidates, String marker) {
        for (Map<String, Object> group : candidates) {
            if (String.valueOf(group.get("name")).endsWith(marker)) {
                return String.valueOf(group.get("id"));
            }
            Object children = group.get("subGroups");
            List<Map<String, Object>> nested = children instanceof List<?> childList && !childList.isEmpty()
                    ? (List<Map<String, Object>>) childList
                    : groups(String.valueOf(group.get("id")));
            String found = findGroupId(nested, marker);
            if (found != null) {
                return found;
            }
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private String findChildGroupId(String parentId, String name) {
        return groups(parentId).stream()
                .filter(group -> name.equals(group.get("name")))
                .map(group -> String.valueOf(group.get("id")))
                .findFirst().orElse(null);
    }

    private void createGroup(String name, String parentId) {
        var request = client.post().uri(uri -> {
            String path = "/admin/realms/" + realm + (parentId == null ? "/groups" : "/groups/" + parentId + "/children");
            return uri.path(path).build();
        }).headers(headers -> headers.setBearerAuth(accessToken()))
                .contentType(MediaType.APPLICATION_JSON).body(Map.of("name", name)).retrieve();
        request.toBodilessEntity();
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> groups(String parentId) {
        String path = "/admin/realms/" + realm
                + (parentId == null ? "/groups" : "/groups/" + parentId + "/children")
                + "?briefRepresentation=false&max=200";
        return client.get().uri(path).headers(headers -> headers.setBearerAuth(accessToken()))
                .retrieve().body(List.class);
    }

    private String accessToken() {
        Token current = token;
        if (current != null && current.expiresAt().isAfter(Instant.now().plusSeconds(30))) {
            return current.value();
        }
        synchronized (this) {
            current = token;
            if (current == null || !current.expiresAt().isAfter(Instant.now().plusSeconds(30))) {
                if (username.isBlank() || password.isBlank()) {
                    throw new IllegalStateException("Credenciais do administrador Keycloak não configuradas");
                }
                var form = new LinkedMultiValueMap<String, String>();
                form.add("grant_type", "password");
                form.add("client_id", clientId);
                form.add("username", username);
                form.add("password", password);
                Map<?, ?> response = client.post()
                        .uri("/realms/master/protocol/openid-connect/token")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .body(form).retrieve().body(Map.class);
                String value = String.valueOf(response.get("access_token"));
                long expiresIn = Long.parseLong(String.valueOf(response.get("expires_in")));
                token = new Token(value, Instant.now().plusSeconds(expiresIn));
            }
            return token.value();
        }
    }

    private record Token(String value, Instant expiresAt) { }
}
