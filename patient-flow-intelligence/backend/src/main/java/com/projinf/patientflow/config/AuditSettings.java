package com.projinf.patientflow.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Central configuration for Audit Logs stored in {@code timescaledb.audit_logs}.
 *
 * <p>Configure via {@code application.yml} under {@code patientflow.audit.*} or via
 * environment variables ({@code AUDIT_LOG_TTL_DAYS}, {@code AUDIT_CLEANUP_CRON}).
 * Administrators can also inspect and update the active TTL at runtime from the
 * Admin Audit Console.
 */
@ConfigurationProperties("patientflow.audit")
public record AuditSettings(
        int defaultTtlDays,
        int minTtlDays,
        int maxTtlDays,
        String cleanupCron
) {
    public AuditSettings {
        if (minTtlDays < 1) {
            minTtlDays = 1;
        }
        if (maxTtlDays < minTtlDays) {
            maxTtlDays = 3650;
        }
        if (defaultTtlDays < minTtlDays || defaultTtlDays > maxTtlDays) {
            defaultTtlDays = Math.max(minTtlDays, Math.min(30, maxTtlDays));
        }
        if (cleanupCron == null || cleanupCron.isBlank()) {
            cleanupCron = "0 0 * * * *";
        }
    }
}
