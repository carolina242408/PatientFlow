package com.projinf.patientflow.repository;

import com.projinf.patientflow.config.AuditSettings;
import com.projinf.patientflow.dto.AuditLogDTO.AuditLogEntry;
import com.projinf.patientflow.dto.AuditLogDTO.AuditLogFilter;
import com.projinf.patientflow.dto.AuditLogDTO.AuditLogPageResponse;
import com.projinf.patientflow.dto.AuditLogDTO.AuditRetentionInfo;
import com.projinf.patientflow.dto.AuditLogDTO.AuditStatsResponse;
import com.projinf.patientflow.dto.AuditLogDTO.PageVisitStat;
import com.projinf.patientflow.dto.AuditLogDTO.RetentionPreviewResponse;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

@Repository
public class AuditLogRepository {

    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};

    private final NamedParameterJdbcTemplate jdbc;
    private final JsonMapper json;
    private final AuditSettings settings;

    public AuditLogRepository(NamedParameterJdbcTemplate jdbc, JsonMapper json, AuditSettings settings) {
        this.jdbc = jdbc;
        this.json = json;
        this.settings = settings;
    }

    public boolean existsRecentLoginForSession(String userId, String sessionId, Instant since) {
        if (userId == null || userId.isBlank() || sessionId == null || sessionId.isBlank()) {
            return false;
        }
        var params = new MapSqlParameterSource()
                .addValue("userId", userId)
                .addValue("sessionId", sessionId)
                .addValue("since", OffsetDateTime.ofInstant(since, ZoneOffset.UTC));
        Long count = jdbc.queryForObject("""
                SELECT count(*)
                  FROM timescaledb.audit_logs
                 WHERE event_type = 'LOGIN'
                   AND user_id = :userId
                   AND session_id = :sessionId
                   AND occurred_at >= :since
                """, params, Long.class);
        return count != null && count > 0;
    }

    public AuditLogEntry insert(
            UUID id,
            Instant occurredAt,
            String eventType,
            String userId,
            String username,
            String userFullName,
            String userEmail,
            List<String> userRoles,
            String pagePath,
            String pageTitle,
            String ipAddress,
            String clientOrigin,
            String userAgent,
            String sessionId,
            Map<String, Object> details
    ) {
        String rolesStr = (userRoles == null || userRoles.isEmpty())
                ? ""
                : String.join(",", userRoles);
        String detailsJson;
        try {
            detailsJson = json.writeValueAsString(details == null ? Map.of() : details);
        } catch (Exception e) {
            detailsJson = "{}";
        }

        OffsetDateTime ts = OffsetDateTime.ofInstant(occurredAt, ZoneOffset.UTC);
        var params = new MapSqlParameterSource()
                .addValue("id", id)
                .addValue("occurredAt", ts)
                .addValue("eventType", eventType)
                .addValue("userId", truncate(userId, 255))
                .addValue("username", truncate(username, 255))
                .addValue("userFullName", truncate(userFullName, 255))
                .addValue("userEmail", truncate(userEmail, 255))
                .addValue("userRoles", truncate(rolesStr, 255))
                .addValue("pagePath", truncate(pagePath, 512))
                .addValue("pageTitle", truncate(pageTitle, 255))
                .addValue("ipAddress", truncate(ipAddress, 128))
                .addValue("clientOrigin", truncate(clientOrigin, 512))
                .addValue("userAgent", truncate(userAgent, 512))
                .addValue("sessionId", truncate(sessionId, 255))
                .addValue("details", detailsJson);

        jdbc.update("""
                INSERT INTO timescaledb.audit_logs (
                    id, occurred_at, event_type, user_id, username, user_full_name,
                    user_email, user_roles, page_path, page_title, ip_address,
                    client_origin, user_agent, session_id, details
                ) VALUES (
                    :id, :occurredAt, :eventType, :userId, :username, :userFullName,
                    :userEmail, :userRoles, :pagePath, :pageTitle, :ipAddress,
                    :clientOrigin, :userAgent, :sessionId, CAST(:details AS jsonb)
                )
                """, params);

        int ttlDays = getCurrentTtlDays();
        return new AuditLogEntry(
                id,
                occurredAt,
                eventType,
                userId,
                username,
                userFullName,
                userEmail,
                userRoles == null ? List.of() : List.copyOf(userRoles),
                pagePath,
                pageTitle,
                ipAddress,
                clientOrigin,
                userAgent,
                sessionId,
                details == null ? Map.of() : details,
                occurredAt.plus(ttlDays, ChronoUnit.DAYS)
        );
    }

    public AuditLogPageResponse search(AuditLogFilter filter) {
        MapSqlParameterSource params = new MapSqlParameterSource();
        String whereClause = buildWhereClause(filter, params);

        int page = Math.max(0, filter.page());
        int size = Math.max(1, Math.min(200, filter.size() <= 0 ? 25 : filter.size()));
        params.addValue("limit", size);
        params.addValue("offset", (long) page * size);

        Long total = jdbc.queryForObject(
                "SELECT count(*) FROM timescaledb.v_admin_audit_logs l " + whereClause,
                params,
                Long.class
        );
        long totalElements = total == null ? 0L : total;
        int totalPages = totalElements == 0 ? 1 : (int) Math.ceil((double) totalElements / size);

        List<AuditLogEntry> items = jdbc.query(
                """
                SELECT l.id, l.occurred_at, l.event_type, l.user_id, l.username,
                       l.user_full_name, l.user_email, l.user_roles, l.page_path,
                       l.page_title, l.ip_address, l.client_origin, l.user_agent,
                       l.session_id, l.details::text AS details_json, l.expires_at
                  FROM timescaledb.v_admin_audit_logs l
                """ + whereClause + """
                 ORDER BY l.occurred_at DESC, l.id DESC
                 LIMIT :limit OFFSET :offset
                """,
                params,
                (rs, rowNum) -> mapEntry(rs)
        );

        return new AuditLogPageResponse(items, totalElements, totalPages, page, size);
    }

    public AuditStatsResponse stats(AuditLogFilter filter) {
        MapSqlParameterSource params = new MapSqlParameterSource();
        String whereClause = buildWhereClause(filter, params);

        var summary = jdbc.queryForObject(
                """
                SELECT count(*) AS total_events,
                       count(*) FILTER (WHERE l.event_type = 'LOGIN') AS login_count,
                       count(*) FILTER (WHERE l.event_type = 'LOGOUT') AS logout_count,
                       count(*) FILTER (WHERE l.event_type = 'PAGE_VIEW') AS page_view_count,
                       count(*) FILTER (WHERE l.event_type = 'CONFIG_CHANGE') AS config_change_count,
                       count(DISTINCT l.user_id) AS unique_users,
                       count(DISTINCT l.ip_address) AS unique_ips
                  FROM timescaledb.v_admin_audit_logs l
                """ + whereClause,
                params,
                (rs, rowNum) -> new long[] {
                        rs.getLong("total_events"),
                        rs.getLong("login_count"),
                        rs.getLong("logout_count"),
                        rs.getLong("page_view_count"),
                        rs.getLong("config_change_count"),
                        rs.getLong("unique_users"),
                        rs.getLong("unique_ips")
                }
        );

        String topPagesWhere = whereClause.isEmpty()
                ? "WHERE l.event_type = 'PAGE_VIEW'"
                : whereClause + " AND l.event_type = 'PAGE_VIEW'";
        List<PageVisitStat> topPages = jdbc.query(
                """
                SELECT l.page_path,
                       max(l.page_title) AS page_title,
                       count(*) AS visit_count
                  FROM timescaledb.v_admin_audit_logs l
                """ + topPagesWhere + """
                 GROUP BY l.page_path
                 ORDER BY visit_count DESC, l.page_path ASC
                 LIMIT 8
                """,
                params,
                (rs, rowNum) -> new PageVisitStat(
                        rs.getString("page_path"),
                        rs.getString("page_title"),
                        rs.getLong("visit_count")
                )
        );

        List<String> distinctPages = jdbc.query(
                """
                SELECT DISTINCT page_path
                  FROM timescaledb.audit_logs
                 WHERE page_path IS NOT NULL AND btrim(page_path) <> ''
                 ORDER BY page_path ASC
                 LIMIT 100
                """,
                Map.of(),
                (rs, rowNum) -> rs.getString(1)
        );

        List<String> distinctUsers = jdbc.query(
                """
                SELECT DISTINCT username
                  FROM timescaledb.audit_logs
                 WHERE username IS NOT NULL AND btrim(username) <> ''
                 ORDER BY username ASC
                 LIMIT 100
                """,
                Map.of(),
                (rs, rowNum) -> rs.getString(1)
        );

        long[] s = summary == null ? new long[7] : summary;
        return new AuditStatsResponse(
                s[0],
                s[1],
                s[2],
                s[3],
                s[4],
                s[5],
                s[6],
                topPages,
                distinctPages,
                distinctUsers,
                getRetentionInfo()
        );
    }

    public int getCurrentTtlDays() {
        Integer ttl = jdbc.query(
                "SELECT ttl_days FROM timescaledb.audit_retention_config WHERE id = 1",
                Map.of(),
                rs -> rs.next() ? rs.getInt("ttl_days") : null
        );
        return ttl == null ? settings.defaultTtlDays() : ttl;
    }

    public void initializeDefaultTtlIfUnset() {
        jdbc.update(
                """
                INSERT INTO timescaledb.audit_retention_config (id, ttl_days, updated_at, updated_by, updated_by_name)
                VALUES (1, :defaultTtl, now(), 'SYSTEM', 'System Default')
                ON CONFLICT (id) DO NOTHING
                """,
                Map.of("defaultTtl", settings.defaultTtlDays())
        );
    }

    public AuditRetentionInfo getRetentionInfo() {
        Boolean timescaleAvailable = jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb')",
                Map.of(),
                Boolean.class
        );

        record StorageSummary(long totalLogs, Instant oldest, Instant newest) {}
        StorageSummary storage = jdbc.queryForObject(
                """
                SELECT count(*) AS total_logs,
                       min(occurred_at) AS oldest_at,
                       max(occurred_at) AS newest_at
                  FROM timescaledb.audit_logs
                """,
                Map.of(),
                (rs, rowNum) -> new StorageSummary(
                        rs.getLong("total_logs"),
                        toInstant(rs.getObject("oldest_at", OffsetDateTime.class)),
                        toInstant(rs.getObject("newest_at", OffsetDateTime.class))
                )
        );
        StorageSummary safeStorage = storage == null ? new StorageSummary(0L, null, null) : storage;

        List<AuditRetentionInfo> rows = jdbc.query(
                """
                SELECT ttl_days, updated_at, updated_by, updated_by_name,
                       last_cleanup_at, last_cleanup_deleted_count
                  FROM timescaledb.audit_retention_config
                 WHERE id = 1
                """,
                Map.of(),
                (rs, rowNum) -> new AuditRetentionInfo(
                        rs.getInt("ttl_days"),
                        settings.defaultTtlDays(),
                        settings.minTtlDays(),
                        settings.maxTtlDays(),
                        settings.cleanupCron(),
                        toInstant(rs.getObject("updated_at", OffsetDateTime.class)),
                        rs.getString("updated_by"),
                        rs.getString("updated_by_name"),
                        toInstant(rs.getObject("last_cleanup_at", OffsetDateTime.class)),
                        rs.getLong("last_cleanup_deleted_count"),
                        safeStorage.totalLogs(),
                        safeStorage.oldest(),
                        safeStorage.newest(),
                        Boolean.TRUE.equals(timescaleAvailable),
                        "timescaledb",
                        "timescaledb.audit_logs"
                )
        );

        if (rows.isEmpty()) {
            return new AuditRetentionInfo(
                    settings.defaultTtlDays(),
                    settings.defaultTtlDays(),
                    settings.minTtlDays(),
                    settings.maxTtlDays(),
                    settings.cleanupCron(),
                    Instant.now(),
                    "SYSTEM",
                    "System Default",
                    null,
                    0L,
                    safeStorage.totalLogs(),
                    safeStorage.oldest(),
                    safeStorage.newest(),
                    Boolean.TRUE.equals(timescaleAvailable),
                    "timescaledb",
                    "timescaledb.audit_logs"
            );
        }
        return rows.getFirst();
    }

    public RetentionPreviewResponse previewRetention(int candidateTtlDays) {
        int currentTtl = getCurrentTtlDays();
        Instant cutoff = Instant.now().minus(candidateTtlDays, ChronoUnit.DAYS);
        var params = Map.of("cutoff", OffsetDateTime.ofInstant(cutoff, ZoneOffset.UTC));

        record Counts(long toDelete, long remaining) {}
        Counts counts = jdbc.queryForObject(
                """
                SELECT count(*) FILTER (WHERE occurred_at < :cutoff) AS to_delete,
                       count(*) FILTER (WHERE occurred_at >= :cutoff) AS remaining
                  FROM timescaledb.audit_logs
                """,
                params,
                (rs, rowNum) -> new Counts(rs.getLong("to_delete"), rs.getLong("remaining"))
        );
        Counts safe = counts == null ? new Counts(0L, 0L) : counts;
        return new RetentionPreviewResponse(
                currentTtl,
                candidateTtlDays,
                safe.toDelete(),
                safe.remaining(),
                cutoff
        );
    }

    public long updateRetentionAndCleanup(int ttlDays, String updatedBy, String updatedByName) {
        jdbc.update(
                """
                INSERT INTO timescaledb.audit_retention_config (id, ttl_days, updated_at, updated_by, updated_by_name)
                VALUES (1, :ttlDays, now(), :updatedBy, :updatedByName)
                ON CONFLICT (id) DO UPDATE
                   SET ttl_days = EXCLUDED.ttl_days,
                       updated_at = now(),
                       updated_by = EXCLUDED.updated_by,
                       updated_by_name = EXCLUDED.updated_by_name
                """,
                Map.of(
                        "ttlDays", ttlDays,
                        "updatedBy", truncate(updatedBy, 255),
                        "updatedByName", truncate(updatedByName, 255)
                )
        );
        return applyRetentionCleanup(ttlDays);
    }

    public long applyRetentionCleanup(Integer overrideTtlDays) {
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("ttlDays", overrideTtlDays);
        Long deleted = jdbc.queryForObject(
                "SELECT timescaledb.fn_apply_audit_retention(:ttlDays)",
                params,
                Long.class
        );
        return deleted == null ? 0L : deleted;
    }

    private String buildWhereClause(AuditLogFilter filter, MapSqlParameterSource params) {
        StringBuilder sb = new StringBuilder(" WHERE 1=1 ");
        if (filter == null) {
            return sb.toString();
        }
        if (filter.search() != null && !filter.search().isBlank()) {
            params.addValue("search", "%" + filter.search().trim().toLowerCase(Locale.ROOT) + "%");
            sb.append("""
                     AND (
                        lower(l.username) LIKE :search
                        OR lower(COALESCE(l.user_full_name, '')) LIKE :search
                        OR lower(COALESCE(l.user_email, '')) LIKE :search
                        OR lower(l.user_id) LIKE :search
                        OR lower(l.page_path) LIKE :search
                        OR lower(COALESCE(l.page_title, '')) LIKE :search
                        OR lower(l.ip_address) LIKE :search
                        OR lower(COALESCE(l.client_origin, '')) LIKE :search
                        OR lower(COALESCE(l.session_id, '')) LIKE :search
                     )
                    """);
        }
        if (filter.eventType() != null && !filter.eventType().isBlank() && !"ALL".equalsIgnoreCase(filter.eventType())) {
            params.addValue("eventType", filter.eventType().trim().toUpperCase(Locale.ROOT));
            sb.append(" AND l.event_type = :eventType ");
        }
        if (filter.role() != null && !filter.role().isBlank() && !"ALL".equalsIgnoreCase(filter.role())) {
            params.addValue("rolePattern", "%" + filter.role().trim().toUpperCase(Locale.ROOT) + "%");
            sb.append(" AND upper(COALESCE(l.user_roles, '')) LIKE :rolePattern ");
        }
        if (filter.pagePath() != null && !filter.pagePath().isBlank() && !"ALL".equalsIgnoreCase(filter.pagePath())) {
            params.addValue("pagePath", filter.pagePath().trim());
            sb.append(" AND (l.page_path = :pagePath OR l.page_path LIKE (:pagePath || '/%')) ");
        }
        if (filter.username() != null && !filter.username().isBlank() && !"ALL".equalsIgnoreCase(filter.username())) {
            params.addValue("username", filter.username().trim().toLowerCase(Locale.ROOT));
            sb.append(" AND lower(l.username) = :username ");
        }
        if (filter.ipAddress() != null && !filter.ipAddress().isBlank()) {
            params.addValue("ipAddress", "%" + filter.ipAddress().trim().toLowerCase(Locale.ROOT) + "%");
            sb.append(" AND lower(l.ip_address) LIKE :ipAddress ");
        }
        if (filter.from() != null) {
            params.addValue("fromTs", OffsetDateTime.ofInstant(filter.from(), ZoneOffset.UTC));
            sb.append(" AND l.occurred_at >= :fromTs ");
        }
        if (filter.to() != null) {
            params.addValue("toTs", OffsetDateTime.ofInstant(filter.to(), ZoneOffset.UTC));
            sb.append(" AND l.occurred_at <= :toTs ");
        }
        return sb.toString();
    }

    private AuditLogEntry mapEntry(ResultSet rs) throws SQLException {
        String rolesStr = rs.getString("user_roles");
        List<String> roles = (rolesStr == null || rolesStr.isBlank())
                ? List.of()
                : Arrays.stream(rolesStr.split(","))
                        .map(String::trim)
                        .filter(s -> !s.isEmpty())
                        .toList();

        Map<String, Object> detailsMap = new HashMap<>();
        String detailsJson = rs.getString("details_json");
        if (detailsJson != null && !detailsJson.isBlank()) {
            try {
                detailsMap = json.readValue(detailsJson, MAP_TYPE);
            } catch (Exception ignored) {
                detailsMap = Map.of();
            }
        }

        return new AuditLogEntry(
                rs.getObject("id", UUID.class),
                toInstant(rs.getObject("occurred_at", OffsetDateTime.class)),
                rs.getString("event_type"),
                rs.getString("user_id"),
                rs.getString("username"),
                rs.getString("user_full_name"),
                rs.getString("user_email"),
                roles,
                rs.getString("page_path"),
                rs.getString("page_title"),
                rs.getString("ip_address"),
                rs.getString("client_origin"),
                rs.getString("user_agent"),
                rs.getString("session_id"),
                detailsMap,
                toInstant(rs.getObject("expires_at", OffsetDateTime.class))
        );
    }

    private static Instant toInstant(OffsetDateTime odt) {
        return odt == null ? null : odt.toInstant();
    }

    private static String truncate(String val, int maxLen) {
        if (val == null) return null;
        String trimmed = val.trim();
        return trimmed.length() <= maxLen ? trimmed : trimmed.substring(0, maxLen);
    }
}
