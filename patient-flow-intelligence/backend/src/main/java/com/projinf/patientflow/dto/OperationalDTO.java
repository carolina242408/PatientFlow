package com.projinf.patientflow.dto;

import com.projinf.patientflow.domain.model.BedStatus;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** API contracts: entities and lazy JPA relationships never escape into JSON. */
public final class OperationalDTO {
    private OperationalDTO() { }

    public record PageResult<T>(List<T> content, int page, int size, long totalElements, long totalPages) { }
    public record Scope(UUID ulsId, UUID unitId, UUID buildingId, UUID floorId, UUID serviceId,
                        UUID wingId, UUID wardId, UUID roomId) { }
    public record HierarchyNode(UUID id, String type, UUID parentId, String name, String code, UUID serviceId) { }
    public record HierarchyWrite(@Size(max = 255) String name, @Size(max = 255) String code,
                                 UUID parentId, UUID serviceId) { }
    public record HierarchyImportRow(
            @NotBlank @Size(max = 255) String uls,
            @Size(max = 255) String unit,
            @Size(max = 255) String building,
            @Size(max = 255) String floor,
            @Size(max = 255) String service,
            @Size(max = 255) String serviceCode,
            @Size(max = 255) String wing,
            @Size(max = 255) String ward,
            @Size(max = 255) String wardCode,
            @Size(max = 255) String room,
            @Size(max = 255) String bed) { }
    public record HierarchyImportRequest(@NotEmpty List<@Valid HierarchyImportRow> rows) { }
    public record HierarchyImportResult(int createdCount, int reusedCount, Map<String, Integer> createdByType) { }
    public record PatientWrite(@NotBlank @Size(max = 255) String snsNumber,
            @NotBlank @Size(max = 255) String fullName, @Size(max = 255) String hospitalNumber,
            @PastOrPresent LocalDate birthDate, @Pattern(regexp = "male|female|other|unknown") String gender) { }
    public record PatientUpdate(@NotNull @PositiveOrZero Long version,
            @NotBlank @Size(max = 255) String fullName, @Size(max = 255) String hospitalNumber,
            @PastOrPresent LocalDate birthDate, @Pattern(regexp = "male|female|other|unknown") String gender) { }
    public record PatientView(UUID id, String snsNumber, String fullName, String hospitalNumber,
                              LocalDate birthDate, String gender, long version) { }
    public record BedView(UUID id, String code, BedStatus status, String reason, long version,
            UUID ulsId, String ulsName, UUID unitId, String unitName, UUID serviceId, String serviceName,
            UUID wardId, String wardCode, UUID roomId, String roomCode,
            UUID patientId, String patientName, LocalDate patientBirthDate, UUID encounterId, Instant admittedAt,
            Instant expectedDischargeAt,
            Instant clinicalDischargeAt) { }
    public record BedMap(PageResult<BedView> beds, Map<BedStatus, Long> counts) { }
    public record BedState(@NotNull BedStatus status, @NotNull @PositiveOrZero Long version,
                           @Size(max = 255) String reason) { }
    public record EncounterView(UUID id, String visitNumber, UUID patientId, String patientName,
            String status, Instant admittedAt, Instant expectedDischargeAt, Instant clinicalDischargeAt,
            Instant administrativeDischargeAt, UUID serviceId, String serviceName, UUID bedId,
            String bedCode, UUID wardId, String wardCode, long version) { }
    public record AllocationView(UUID id, UUID encounterId, String visitNumber, UUID patientId,
            UUID bedId, String bedCode, UUID wardId, Instant assignedAt, Instant dischargedAt) { }
    public record DischargePlan(@NotNull @PositiveOrZero Long version, Instant expectedDischargeAt) { }
    public record DischargeAction(@NotNull @PositiveOrZero Long version, Instant at) { }
    public record AdmissionRequestWrite(@NotBlank @Size(max = 255) String requestNumber,
            @NotNull UUID patientId, @NotNull UUID serviceId, @NotNull AdmissionOrigin origin,
            @NotNull @Min(1) @Max(5) Integer priority, Instant requestedAt, Instant desiredAdmissionAt) { }
    public enum AdmissionOrigin { EMERGENCY, SCHEDULED, SURGICAL, TRANSFER, OTHER }
    public enum RequestStatus { WAITING, ADMITTED, CANCELLED }
    public record AdmissionRequestView(UUID id, String requestNumber, UUID patientId, String patientName,
            UUID serviceId, String serviceName, AdmissionOrigin origin, int priority, Instant requestedAt,
            Instant desiredAdmissionAt, RequestStatus status, UUID encounterId, Instant closedAt, long version) { }
    public record AdmissionRequestUpdate(@NotNull @PositiveOrZero Long version,
            @NotNull @Min(1) @Max(5) Integer priority, Instant desiredAdmissionAt) { }
    public record QueueAdmission(@NotNull @PositiveOrZero Long version, @NotNull UUID bedId,
            @NotBlank @Size(max = 255) String visitNumber, Instant admittedAt) { }
    public record Version(@NotNull @PositiveOrZero Long version) { }
}
