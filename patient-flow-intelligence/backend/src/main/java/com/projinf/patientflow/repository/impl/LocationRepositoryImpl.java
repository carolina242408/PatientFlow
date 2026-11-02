package com.projinf.patientflow.repository.impl;

import com.projinf.patientflow.domain.model.Bed;
import com.projinf.patientflow.domain.model.BedStatus;
import com.projinf.patientflow.domain.model.LocationAllocation;
import com.projinf.patientflow.exception.ResourceNotFoundException;
import com.projinf.patientflow.repository.ILocationRepository;
import com.projinf.patientflow.repository.jpa.BedJpaRepository;
import com.projinf.patientflow.repository.jpa.LocationAllocationJpaRepository;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Repository
@Transactional
public class LocationRepositoryImpl implements ILocationRepository {

    private final BedJpaRepository beds;
    private final LocationAllocationJpaRepository allocations;

    public LocationRepositoryImpl(BedJpaRepository beds, LocationAllocationJpaRepository allocations) {
        this.beds = beds;
        this.allocations = allocations;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Bed> findBedByHierarchy(String wardCode, String roomCode, String bedCode) {
        return beds.findByHierarchy(wardCode, roomCode, bedCode);
    }

    @Override
    public void updateBedStatus(UUID bedId, BedStatus status) {
        Bed bed = beds.findById(bedId)
                .orElseThrow(() -> new ResourceNotFoundException("Cama " + bedId + " não encontrada"));
        bed.setStatus(status);
    }

    @Override
    public LocationAllocation createAllocation(LocationAllocation allocation) {
        return allocations.save(allocation);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<LocationAllocation> findOpenAllocation(UUID encounterId) {
        return allocations.findFirstByEncounterIdAndDischargedAtIsNull(encounterId);
    }

    @Override
    public Optional<UUID> closeAllocation(UUID encounterId, Instant dischargedAt) {
        return allocations.findFirstByEncounterIdAndDischargedAtIsNull(encounterId)
                .map(a -> {
                    a.setDischargedAt(dischargedAt);
                    return a.getBed().getId();
                });
    }
}
