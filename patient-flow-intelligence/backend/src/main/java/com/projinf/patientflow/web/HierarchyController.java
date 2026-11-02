package com.projinf.patientflow.web;

import com.projinf.patientflow.dto.OperationalDTO.*;
import com.projinf.patientflow.repository.HierarchyRepository;
import com.projinf.patientflow.repository.HierarchyRepository.Type;
import com.projinf.patientflow.service.HierarchyService;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/hierarchy/{type}")
public class HierarchyController {
    private final HierarchyRepository repository;
    private final HierarchyService service;
    public HierarchyController(HierarchyRepository repository, HierarchyService service) {
        this.repository = repository; this.service = service;
    }
    @GetMapping
    public PageResult<HierarchyNode> list(@PathVariable String type, @RequestParam(required = false) UUID parentId,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return repository.list(Type.parse(type), parentId, page, size);
    }
    @GetMapping("/{id}")
    public HierarchyNode get(@PathVariable String type, @PathVariable UUID id) { return repository.get(Type.parse(type), id); }
    @PostMapping @ResponseStatus(HttpStatus.CREATED)
    public HierarchyNode create(@PathVariable String type, @Valid @RequestBody HierarchyWrite input) {
        return service.create(Type.parse(type), input);
    }
    @PutMapping("/{id}")
    public HierarchyNode update(@PathVariable String type, @PathVariable UUID id, @Valid @RequestBody HierarchyWrite input) {
        return service.update(Type.parse(type), id, input);
    }
    @DeleteMapping("/{id}") @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String type, @PathVariable UUID id) { service.delete(Type.parse(type), id); }
}
