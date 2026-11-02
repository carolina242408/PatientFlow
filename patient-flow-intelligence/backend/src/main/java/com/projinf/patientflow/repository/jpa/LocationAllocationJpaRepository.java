package com.projinf.patientflow.repository.jpa;

import com.projinf.patientflow.domain.model.LocationAllocation;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface LocationAllocationJpaRepository extends JpaRepository<LocationAllocation, UUID> {
    Optional<LocationAllocation> findFirstByEncounterIdAndDischargedAtIsNull(UUID encounterId);
    Optional<LocationAllocation> findFirstByEncounterIdOrderByAssignedAtDesc(UUID encounterId);
}
