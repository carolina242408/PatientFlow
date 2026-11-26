package com.projinf.patientflow.web;

import com.projinf.patientflow.dto.OperationalDTO.HierarchyImportRequest;
import com.projinf.patientflow.dto.OperationalDTO.HierarchyImportResult;
import com.projinf.patientflow.service.HierarchyService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/hierarchy/import")
public class HierarchyImportController {
    private final HierarchyService service;

    public HierarchyImportController(HierarchyService service) {
        this.service = service;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public HierarchyImportResult importHierarchy(@Valid @RequestBody HierarchyImportRequest request) {
        return service.importHierarchy(request.rows());
    }
}
