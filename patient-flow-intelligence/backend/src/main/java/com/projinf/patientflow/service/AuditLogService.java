package com.projinf.patientflow.service;

import com.projinf.patientflow.config.AuditSettings;
import com.projinf.patientflow.dto.AuditLogDTO.AuditLogEntry;
import com.projinf.patientflow.dto.AuditLogDTO.AuditLogFilter;
import com.projinf.patientflow.dto.AuditLogDTO.AuditLogPageResponse;
import com.projinf.patientflow.dto.AuditLogDTO.AuditRetentionInfo;
import com.projinf.patientflow.dto.AuditLogDTO.AuditStatsResponse;
import com.projinf.patientflow.dto.AuditLogDTO.CreateAuditEventRequest;
import com.projinf.patientflow.dto.AuditLogDTO.EventType;
import com.projinf.patientflow.dto.AuditLogDTO.RetentionPreviewResponse;
import com.projinf.patientflow.dto.AuditLogDTO.UpdateRetentionRequest;
import com.projinf.patientflow.dto.AuditLogDTO.UpdateRetentionResponse;
import com.projinf.patientflow.repository.AuditLogRepository;
import com.projinf.patientflow.security.AccessPolicy;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuditLogService {

    private static final Logger log = LoggerFactory.getLogger(AuditLogService.class);

    private final AuditLogRepository repository;
    private final AccessPolicy access;
    private final AuditSettings settings;

    public AuditLogService(AuditLogRepository repository, AccessPolicy access, AuditSettings settings) {
        this.repository = repository;
        this.access = access;
        this.settings = settings;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onApplicationReady() {
        try {
            repository.initializeDefaultTtlIfUnset();
            long purged = repository.applyRetentionCleanup(null);
            if (purged > 0) {
                log.info("Audit log startup cleanup purged {} expired entries", purged);
            }
        } catch (Exception e) {
            log.warn("Audit log startup initialization skipped: {}", e.getMessage());
        }
    }

    @Scheduled(cron = "${patientflow.audit.cleanup-cron:0 0 * * * *}")
    public void scheduledRetentionCleanup() {
        try {
            long purged = repository.applyRetentionCleanup(null);
            if (purged > 0) {
                log.info("Scheduled audit log TTL cleanup purged {} expired entries", purged);
            }
        } catch (Exception e) {
            log.warn("Scheduled audit log TTL cleanup failed: {}", e.getMessage());
        }
    }

    @Transactional
    public AuditLogEntry recordClientEvent(CreateAuditEventRequest req, HttpServletRequest httpRequest) {
        JwtUser user = currentJwtUser();
        EventType type = req.eventType() == null ? EventType.PAGE_VIEW : req.eventType();
        if (type == EventType.CONFIG_CHANGE) {
            type = EventType.PAGE_VIEW;
        }

        String pagePath = normalizePagePath(req.pagePath());
        String ipAddress = extractClientIp(httpRequest);
        String userAgent = extractUserAgent(httpRequest);
        String clientOrigin = resolveClientOrigin(req.clientOrigin(), httpRequest, userAgent);

        if (type == EventType.LOGIN && user.sessionId() != null && !user.sessionId().isBlank()) {
            Instant since = Instant.now().minus(12, ChronoUnit.HOURS);
            if (repository.existsRecentLoginForSession(user.userId(), user.sessionId(), since)) {
                return new AuditLogEntry(
                        UUID.randomUUID(),
                        Instant.now(),
                        EventType.LOGIN.name(),
                        user.userId(),
                        user.username(),
                        user.fullName(),
                        user.email(),
                        user.roles(),
                        pagePath,
                        req.pageTitle(),
                        ipAddress,
                        clientOrigin,
                        userAgent,
                        user.sessionId(),
                        req.details() == null ? Map.of("deduplicated", true) : req.details(),
                        Instant.now().plus(repository.getCurrentTtlDays(), ChronoUnit.DAYS)
                );
            }
        }

        Map<String, Object> details = new HashMap<>();
        if (req.details() != null) {
            details.putAll(req.details());
        }
        details.putIfAbsent("browserSummary", summarizeUserAgent(userAgent));

        return repository.insert(
                UUID.randomUUID(),
                Instant.now(),
                type.name(),
                user.userId(),
                user.username(),
                user.fullName(),
                user.email(),
                user.roles(),
                pagePath,
                req.pageTitle(),
                ipAddress,
                clientOrigin,
                userAgent,
                user.sessionId(),
                details
        );
    }

    @Transactional
    public void recordLoginOnAccessCheckIfNeeded(HttpServletRequest httpRequest) {
        try {
            JwtUser user = currentJwtUser();
            if (user.sessionId() == null || user.sessionId().isBlank()) {
                return;
            }
            Instant since = Instant.now().minus(12, ChronoUnit.HOURS);
            if (repository.existsRecentLoginForSession(user.userId(), user.sessionId(), since)) {
                return;
            }
            String ipAddress = extractClientIp(httpRequest);
            String userAgent = extractUserAgent(httpRequest);
            String clientOrigin = resolveClientOrigin(null, httpRequest, userAgent);
            String refererPath = extractRefererPath(httpRequest);

            repository.insert(
                    UUID.randomUUID(),
                    Instant.now(),
                    EventType.LOGIN.name(),
                    user.userId(),
                    user.username(),
                    user.fullName(),
                    user.email(),
                    user.roles(),
                    refererPath,
                    "Session Login",
                    ipAddress,
                    clientOrigin,
                    userAgent,
                    user.sessionId(),
                    Map.of(
                            "source", "oidc_session_init",
                            "browserSummary", summarizeUserAgent(userAgent)
                    )
            );
        } catch (Exception e) {
            log.debug("Could not auto-record login audit log: {}", e.getMessage());
        }
    }

    public AuditLogPageResponse searchLogs(AuditLogFilter filter) {
        access.admin();
        return repository.search(filter);
    }

    public AuditStatsResponse getStats(AuditLogFilter filter) {
        access.admin();
        return repository.stats(filter);
    }

    public AuditRetentionInfo getRetentionInfo() {
        access.admin();
        return repository.getRetentionInfo();
    }

    public RetentionPreviewResponse previewRetentionChange(int candidateTtlDays) {
        access.admin();
        validateTtlBounds(candidateTtlDays);
        return repository.previewRetention(candidateTtlDays);
    }

    @Transactional
    public UpdateRetentionResponse updateRetention(UpdateRetentionRequest req, HttpServletRequest httpRequest) {
        access.admin();
        if (!req.confirmed()) {
            throw new IllegalArgumentException("A confirmação explícita é obrigatória para alterar o TTL dos logs de auditoria");
        }
        int newTtl = req.ttlDays();
        validateTtlBounds(newTtl);

        JwtUser user = currentJwtUser();
        int previousTtl = repository.getCurrentTtlDays();
        long deletedCount = repository.updateRetentionAndCleanup(newTtl, user.username(), user.fullName());

        String ipAddress = extractClientIp(httpRequest);
        String userAgent = extractUserAgent(httpRequest);
        String clientOrigin = resolveClientOrigin(null, httpRequest, userAgent);

        repository.insert(
                UUID.randomUUID(),
                Instant.now(),
                EventType.CONFIG_CHANGE.name(),
                user.userId(),
                user.username(),
                user.fullName(),
                user.email(),
                user.roles(),
                "/admin",
                "Audit Retention Policy Updated",
                ipAddress,
                clientOrigin,
                userAgent,
                user.sessionId(),
                Map.of(
                        "action", "UPDATE_AUDIT_TTL_DAYS",
                        "previousTtlDays", previousTtl,
                        "newTtlDays", newTtl,
                        "deletedExpiredRecords", deletedCount,
                        "browserSummary", summarizeUserAgent(userAgent)
                )
        );

        return new UpdateRetentionResponse(repository.getRetentionInfo(), deletedCount);
    }

    @Transactional
    public UpdateRetentionResponse runCleanupNow(HttpServletRequest httpRequest) {
        access.admin();
        long deletedCount = repository.applyRetentionCleanup(null);
        return new UpdateRetentionResponse(repository.getRetentionInfo(), deletedCount);
    }

    private void validateTtlBounds(int ttlDays) {
        if (ttlDays < settings.minTtlDays() || ttlDays > settings.maxTtlDays()) {
            throw new IllegalArgumentException(
                    "O TTL deve estar entre " + settings.minTtlDays() + " e " + settings.maxTtlDays() + " dias"
            );
        }
    }

    private record JwtUser(
            String userId,
            String username,
            String fullName,
            String email,
            List<String> roles,
            String sessionId
    ) {}

    private JwtUser currentJwtUser() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || !(auth.getPrincipal() instanceof Jwt jwt)
                || jwt.getSubject() == null || jwt.getSubject().isBlank()) {
            throw new AccessDeniedException("Identidade Keycloak obrigatória");
        }
        String sub = jwt.getSubject();
        String preferredUsername = jwt.getClaimAsString("preferred_username");
        String email = jwt.getClaimAsString("email");
        String name = jwt.getClaimAsString("name");
        if (name == null || name.isBlank()) {
            String given = jwt.getClaimAsString("given_name");
            String family = jwt.getClaimAsString("family_name");
            name = ((given == null ? "" : given) + " " + (family == null ? "" : family)).trim();
        }
        String username = (preferredUsername != null && !preferredUsername.isBlank())
                ? preferredUsername
                : (email != null && !email.isBlank() ? email : sub);
        String fullName = (name != null && !name.isBlank()) ? name : username;
        String sid = jwt.getClaimAsString("sid");
        if (sid == null || sid.isBlank()) {
            sid = jwt.getClaimAsString("session_state");
        }
        List<String> roles = auth.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .toList();

        return new JwtUser(sub, username, fullName, email, roles, sid);
    }

    public static String extractClientIp(HttpServletRequest request) {
        if (request == null) {
            return "unknown";
        }
        String[] headers = {
                "X-Forwarded-For",
                "X-Real-IP",
                "CF-Connecting-IP",
                "True-Client-IP",
                "X-Client-IP"
        };
        for (String header : headers) {
            String raw = request.getHeader(header);
            if (raw != null && !raw.isBlank() && !"unknown".equalsIgnoreCase(raw.trim())) {
                String first = raw.split(",")[0].trim();
                if (!first.isEmpty()) {
                    return normalizeIp(first);
                }
            }
        }
        String forwarded = request.getHeader("Forwarded");
        if (forwarded != null && !forwarded.isBlank()) {
            for (String part : forwarded.split(";")) {
                String trimmed = part.trim();
                if (trimmed.toLowerCase(Locale.ROOT).startsWith("for=")) {
                    String val = trimmed.substring(4).replace("\"", "").trim();
                    if (!val.isEmpty()) {
                        return normalizeIp(val);
                    }
                }
            }
        }
        String remote = request.getRemoteAddr();
        return (remote == null || remote.isBlank()) ? "unknown" : normalizeIp(remote.trim());
    }

    private static String normalizeIp(String ip) {
        if ("0:0:0:0:0:0:0:1".equals(ip) || "::1".equals(ip)) {
            return "127.0.0.1";
        }
        if (ip.startsWith("::ffff:")) {
            return ip.substring(7);
        }
        return ip;
    }

    private static String extractUserAgent(HttpServletRequest request) {
        if (request == null) return "Unknown";
        String ua = request.getHeader("User-Agent");
        return (ua == null || ua.isBlank()) ? "Unknown" : ua.trim();
    }

    private static String resolveClientOrigin(String clientProvidedOrigin, HttpServletRequest request, String userAgent) {
        String summary = summarizeUserAgent(userAgent);
        if (clientProvidedOrigin != null && !clientProvidedOrigin.isBlank()) {
            return summary + " · " + clientProvidedOrigin.trim();
        }
        if (request != null) {
            String origin = request.getHeader("Origin");
            if (origin != null && !origin.isBlank()) {
                return summary + " · " + origin.trim();
            }
            String host = request.getHeader("Host");
            if (host != null && !host.isBlank()) {
                return summary + " · " + host.trim();
            }
        }
        return summary;
    }

    private static String extractRefererPath(HttpServletRequest request) {
        if (request == null) return "/";
        String referer = request.getHeader("Referer");
        if (referer != null && !referer.isBlank()) {
            try {
                java.net.URI uri = java.net.URI.create(referer.trim());
                String path = uri.getPath();
                if (path != null && !path.isBlank()) {
                    return path;
                }
            } catch (Exception ignored) {
            }
        }
        return "/";
    }

    private static String normalizePagePath(String pagePath) {
        if (pagePath == null || pagePath.isBlank()) {
            return "/";
        }
        String p = pagePath.trim();
        return p.startsWith("/") ? p : "/" + p;
    }

    public static String summarizeUserAgent(String ua) {
        if (ua == null || ua.isBlank()) {
            return "Unknown Client";
        }
        String browser = "Browser";
        if (ua.contains("Edg/")) {
            browser = "Edge";
        } else if (ua.contains("OPR/") || ua.contains("Opera")) {
            browser = "Opera";
        } else if (ua.contains("Chrome/") && !ua.contains("Edg/")) {
            browser = "Chrome";
        } else if (ua.contains("Firefox/")) {
            browser = "Firefox";
        } else if (ua.contains("Safari/") && !ua.contains("Chrome/")) {
            browser = "Safari";
        } else if (ua.contains("curl/")) {
            browser = "curl";
        }

        String os = "OS";
        if (ua.contains("Windows")) {
            os = "Windows";
        } else if (ua.contains("Mac OS X") || ua.contains("Macintosh")) {
            os = "macOS";
        } else if (ua.contains("Android")) {
            os = "Android";
        } else if (ua.contains("iPhone") || ua.contains("iPad")) {
            os = "iOS";
        } else if (ua.contains("Linux")) {
            os = "Linux";
        }

        return browser + " on " + os;
    }
}
