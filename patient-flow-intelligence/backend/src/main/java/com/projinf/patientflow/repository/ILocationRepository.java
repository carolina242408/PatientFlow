package com.projinf.patientflow.repository;

import com.projinf.patientflow.domain.model.Bed;
import com.projinf.patientflow.domain.model.BedStatus;
import com.projinf.patientflow.domain.model.LocationAllocation;

import java.util.Optional;
import java.util.UUID;
import java.time.Instant;

public interface ILocationRepository {
    Optional<Bed> findBedByHierarchy(String wardCode, String roomCode, String bedCode);

    void updateBedStatus(UUID bedId, BedStatus status);

    LocationAllocation createAllocation(LocationAllocation allocation);

    Optional<LocationAllocation> findOpenAllocation(UUID encounterId);

    /** Closes the open allocation at the effective discharge time and returns the released bed. */
    Optional<UUID> closeAllocation(UUID encounterId, Instant dischargedAt);
}
