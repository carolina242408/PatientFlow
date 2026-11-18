package com.projinf.patientflow.web;

import com.projinf.patientflow.dto.AuditLogDTO.AuditLogEntry;
import com.projinf.patientflow.dto.AuditLogDTO.AuditLogFilter;
import com.projinf.patientflow.dto.AuditLogDTO.AuditLogPageResponse;
import com.projinf.patientflow.dto.AuditLogDTO.AuditRetentionInfo;
import com.projinf.patientflow.dto.AuditLogDTO.AuditStatsResponse;
import com.projinf.patientflow.dto.AuditLogDTO.CreateAuditEventRequest;
import com.projinf.patientflow.dto.AuditLogDTO.RetentionPreviewResponse;
import com.projinf.patientflow.dto.AuditLogDTO.UpdateRetentionRequest;
import com.projinf.patientflow.dto.AuditLogDTO.UpdateRetentionResponse;
import com.projinf.patientflow.service.AuditLogService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.time.Instant;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/audit")
public class AuditLogController {

    private final AuditLogService auditLogs;

    public AuditLogController(AuditLogService auditLogs) {
        this.auditLogs = auditLogs;
    }

    @PostMapping("/events")
    @ResponseStatus(HttpStatus.CREATED)
    public AuditLogEntry recordEvent(
            @Valid @RequestBody CreateAuditEventRequest input,
            HttpServletRequest request
    ) {
        return auditLogs.recordClientEvent(input, request);
    }

    @GetMapping("/logs")
    public AuditLogPageResponse searchLogs(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String eventType,
            @RequestParam(required = false) String role,
            @RequestParam(required = false) String pagePath,
            @RequestParam(required = false) String username,
            @RequestParam(required = false) String ipAddress,
            @RequestParam(required = false) Instant from,
            @RequestParam(required = false) Instant to,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size
    ) {
        return auditLogs.searchLogs(new AuditLogFilter(
                search, eventType, role, pagePath, username, ipAddress, from, to, page, size
        ));
    }

    @GetMapping("/stats")
    public AuditStatsResponse getStats(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String eventType,
            @RequestParam(required = false) String role,
            @RequestParam(required = false) String pagePath,
            @RequestParam(required = false) String username,
            @RequestParam(required = false) String ipAddress,
            @RequestParam(required = false) Instant from,
            @RequestParam(required = false) Instant to
    ) {
        return auditLogs.getStats(new AuditLogFilter(
                search, eventType, role, pagePath, username, ipAddress, from, to, 0, 25
        ));
    }

    @GetMapping("/retention")
    public AuditRetentionInfo getRetention() {
        return auditLogs.getRetentionInfo();
    }

    @GetMapping("/retention/preview")
    public RetentionPreviewResponse previewRetention(@RequestParam int ttlDays) {
        return auditLogs.previewRetentionChange(ttlDays);
    }

    @PutMapping("/retention")
    public UpdateRetentionResponse updateRetention(
            @Valid @RequestBody UpdateRetentionRequest input,
            HttpServletRequest request
    ) {
        return auditLogs.updateRetention(input, request);
    }

    @PostMapping("/retention/cleanup")
    public UpdateRetentionResponse runCleanupNow(HttpServletRequest request) {
        return auditLogs.runCleanupNow(request);
    }
}
