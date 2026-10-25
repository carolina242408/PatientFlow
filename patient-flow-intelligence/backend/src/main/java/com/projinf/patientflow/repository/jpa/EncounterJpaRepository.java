package com.projinf.patientflow.repository.jpa;

import com.projinf.patientflow.domain.model.Encounter;
import com.projinf.patientflow.domain.model.EncounterStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface EncounterJpaRepository extends JpaRepository<Encounter, UUID> {
    Optional<Encounter> findByVisitNumber(String visitNumber);
    boolean existsByPatientIdAndStatus(UUID patientId, EncounterStatus status);
}
