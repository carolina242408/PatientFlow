package com.projinf.patientflow.web;

import com.projinf.patientflow.domain.model.BedStatus;
import com.projinf.patientflow.domain.model.EncounterStatus;
import com.projinf.patientflow.dto.OperationalDTO.*;
import com.projinf.patientflow.repository.OperationalQueries;
import com.projinf.patientflow.service.AdmissionQueueService;
import com.projinf.patientflow.service.OperationalService;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class OperationsController {
    private final OperationalQueries queries;
    private final OperationalService operations;
    private final AdmissionQueueService queue;
    public OperationsController(OperationalQueries queries, OperationalService operations, AdmissionQueueService queue) {
        this.queries = queries; this.operations = operations; this.queue = queue;
    }

    @GetMapping("/patients")
    public PageResult<PatientView> patients(@ModelAttribute Scope scope, @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return queries.patients(scope, q, page, size);
    }
    @GetMapping("/patients/{id}")
    public PatientView patient(@PathVariable UUID id) { return queries.patient(id); }
    @PostMapping("/patients") @ResponseStatus(HttpStatus.CREATED)
    public PatientView createPatient(@Valid @RequestBody PatientWrite input) { return operations.createPatient(input); }
    @PutMapping("/patients/{id}")
    public PatientView updatePatient(@PathVariable UUID id, @Valid @RequestBody PatientUpdate input) {
        return operations.updatePatient(id, input);
    }

    @GetMapping("/beds")
    public PageResult<BedView> beds(@ModelAttribute Scope scope, @RequestParam(required = false) BedStatus status,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return queries.beds(scope, status, page, size);
    }
    @GetMapping("/beds/{id}")
    public BedView bed(@PathVariable UUID id) { return queries.bed(id); }
    @PutMapping("/beds/{id}/status")
    public BedView bedStatus(@PathVariable UUID id, @Valid @RequestBody BedState input) {
        return operations.changeBedState(id, input);
    }
    @GetMapping("/bed-map")
    public BedMap bedMap(@ModelAttribute Scope scope, @RequestParam(required = false) BedStatus status,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return queries.bedMap(scope, status, page, size);
    }

    @GetMapping("/encounters")
    public PageResult<EncounterView> encounters(@ModelAttribute Scope scope, @RequestParam(required = false) EncounterStatus status,
            @RequestParam(required = false) UUID patientId, @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return queries.encounters(scope, status, patientId, page, size);
    }
    @GetMapping("/encounters/{id}")
    public EncounterView encounter(@PathVariable UUID id) { return queries.encounter(id); }
    @PutMapping("/encounters/{id}/discharge-plan")
    public EncounterView plan(@PathVariable UUID id, @Valid @RequestBody DischargePlan input) {
        return operations.planDischarge(id, input);
    }
    @PostMapping("/encounters/{id}/clinical-discharge")
    public EncounterView clinical(@PathVariable UUID id, @Valid @RequestBody DischargeAction input) {
        return operations.clinicalDischarge(id, input);
    }
    @PostMapping("/encounters/{id}/administrative-discharge")
    public EncounterView administrative(@PathVariable UUID id, @Valid @RequestBody DischargeAction input) {
        return operations.administrativeDischarge(id, input);
    }
    @GetMapping("/allocations")
    public PageResult<AllocationView> history(@ModelAttribute Scope scope, @RequestParam(required = false) UUID bedId,
            @RequestParam(required = false) UUID encounterId, @RequestParam(required = false) UUID patientId,
            @RequestParam(required = false) Boolean active, @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return queries.allocations(scope, bedId, encounterId, patientId, active, page, size);
    }

    @GetMapping("/admission-requests")
    public PageResult<AdmissionRequestView> requests(@ModelAttribute Scope scope,
            @RequestParam(required = false) RequestStatus status, @RequestParam(required = false) AdmissionOrigin origin,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return queries.requests(scope, status, origin, page, size);
    }
    @GetMapping("/admission-requests/{id}")
    public AdmissionRequestView request(@PathVariable UUID id) { return queries.request(id); }
    @PostMapping("/admission-requests") @ResponseStatus(HttpStatus.CREATED)
    public AdmissionRequestView createRequest(@Valid @RequestBody AdmissionRequestWrite input) { return queue.create(input); }
    @PutMapping("/admission-requests/{id}")
    public AdmissionRequestView updateRequest(@PathVariable UUID id, @Valid @RequestBody AdmissionRequestUpdate input) {
        return queue.update(id, input);
    }
    @PostMapping("/admission-requests/{id}/cancel")
    public AdmissionRequestView cancel(@PathVariable UUID id, @Valid @RequestBody Version input) {
        return queue.cancel(id, input.version());
    }
    @PostMapping("/admission-requests/{id}/admit")
    public AdmissionRequestView admit(@PathVariable UUID id, @Valid @RequestBody QueueAdmission input) { return queue.admit(id, input); }
}
