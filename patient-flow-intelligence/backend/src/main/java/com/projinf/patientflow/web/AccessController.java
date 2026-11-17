package com.projinf.patientflow.web;

import com.projinf.patientflow.security.ScopeGrantService;
import com.projinf.patientflow.security.ScopeGrantService.*;
import com.projinf.patientflow.service.AuditLogService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/access")
public class AccessController {
    private final ScopeGrantService grants;
    private final AuditLogService auditLogs;
    public AccessController(ScopeGrantService grants, AuditLogService auditLogs) {
        this.grants = grants;
        this.auditLogs = auditLogs;
    }
    @GetMapping("/me")
    public AccessSummary me(HttpServletRequest request) {
        AccessSummary summary = grants.me();
        auditLogs.recordLoginOnAccessCheckIfNeeded(request);
        return summary;
    }
    @GetMapping("/grants") public List<Grant> list(@RequestParam(required=false) String subject) { return grants.list(subject); }
    @PostMapping("/grants") @ResponseStatus(HttpStatus.CREATED)
    public Grant create(@Valid @RequestBody GrantInput input) { return grants.create(input); }
    @DeleteMapping("/grants/{id}") @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) { grants.delete(id); }
}
