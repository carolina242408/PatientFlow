package com.projinf.patientflow.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class AuditLogDTO {
    private AuditLogDTO() {}

    public enum EventType {
        LOGIN,
        LOGOUT,
        PAGE_VIEW,
        CONFIG_CHANGE
    }

    public record CreateAuditEventRequest(
            @NotNull EventType eventType,
            @NotBlank @Size(max = 512) String pagePath,
            @Size(max = 255) String pageTitle,
            @Size(max = 512) String clientOrigin,
            Map<String, Object> details
    ) {}

    public record AuditLogEntry(
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
            Map<String, Object> details,
            Instant expiresAt
    ) {}

    public record AuditLogFilter(
            String search,
            String eventType,
            String role,
            String pagePath,
            String username,
            String ipAddress,
            Instant from,
            Instant to,
            int page,
            int size
    ) {}

    public record AuditLogPageResponse(
            List<AuditLogEntry> items,
            long totalElements,
            int totalPages,
            int page,
            int size
    ) {}

    public record PageVisitStat(
            String pagePath,
            String pageTitle,
            long visitCount
    ) {}

    public record AuditRetentionInfo(
            int ttlDays,
            int defaultTtlDays,
            int minTtlDays,
            int maxTtlDays,
            String cleanupCron,
            Instant updatedAt,
            String updatedBy,
            String updatedByName,
            Instant lastCleanupAt,
            long lastCleanupDeletedCount,
            long totalStoredLogs,
            Instant oldestLogAt,
            Instant newestLogAt,
            boolean timescaleEnabled,
            String schemaName,
            String tableName
    ) {}

    public record RetentionPreviewResponse(
            int currentTtlDays,
            int candidateTtlDays,
            long recordsToBeDeleted,
            long recordsRemaining,
            Instant cutoffTimestamp
    ) {}

    public record UpdateRetentionRequest(
            @Min(1) @Max(3650) int ttlDays,
            boolean confirmed
    ) {}

    public record UpdateRetentionResponse(
            AuditRetentionInfo retention,
            long deletedCount
    ) {}

    public record AuditStatsResponse(
            long totalEvents,
            long loginCount,
            long logoutCount,
            long pageViewCount,
            long configChangeCount,
            long uniqueUsers,
            long uniqueIps,
            List<PageVisitStat> topPages,
            List<String> distinctPages,
            List<String> distinctUsers,
            AuditRetentionInfo retention
    ) {}
}
