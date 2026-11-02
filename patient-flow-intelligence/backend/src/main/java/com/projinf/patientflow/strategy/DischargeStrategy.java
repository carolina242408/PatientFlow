package com.projinf.patientflow.strategy;

import com.projinf.patientflow.domain.model.Bed;
import com.projinf.patientflow.domain.model.BedStatus;
import com.projinf.patientflow.domain.model.Encounter;
import com.projinf.patientflow.domain.model.EncounterStatus;
import com.projinf.patientflow.domain.model.LocationAllocation;
import com.projinf.patientflow.dto.ParsedBundleDTO;
import com.projinf.patientflow.exception.ConflictException;
import com.projinf.patientflow.exception.ResourceNotFoundException;
import com.projinf.patientflow.repository.IEncounterRepository;
import com.projinf.patientflow.repository.ILocationRepository;
import com.projinf.patientflow.repository.jpa.BedJpaRepository;
import com.projinf.patientflow.repository.jpa.LocationAllocationJpaRepository;
import com.projinf.patientflow.service.EncounterRules;
import java.time.Instant;
import com.projinf.patientflow.event.ChangePublisher;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component("finished")
public class DischargeStrategy implements IEncounterStrategy {
    private final ChangePublisher changes;
    private final IEncounterRepository encounters;
    private final ILocationRepository locations;
    private final BedJpaRepository beds;
    private final LocationAllocationJpaRepository allocations;

    public DischargeStrategy(IEncounterRepository encounters, ILocationRepository locations,
            BedJpaRepository beds, LocationAllocationJpaRepository allocations, ChangePublisher changes) {
        this.changes=changes;
        this.encounters = encounters;
        this.locations = locations;
        this.beds = beds;
        this.allocations = allocations;
    }

    @Override
    @Transactional
    public void process(ParsedBundleDTO bundle) {
        Encounter encounter = encounters.findByVisitNumber(bundle.encounter().getVisitNumber())
            .orElseThrow(() -> new ResourceNotFoundException("Episódio de internamento não encontrado"));
        LocationAllocation allocation = allocations.findFirstByEncounterIdOrderByAssignedAtDesc(encounter.getId())
            .orElseThrow(() -> new ConflictException("Episódio sem histórico de alocação"));
        EncounterRules.sameEpisode(bundle, encounter, allocation);
        if (encounter.getStatus() == EncounterStatus.FINISHED) {
            Instant suppliedEnd = bundle.encounter().getEndPeriod();
            if (suppliedEnd != null && !EncounterRules.precise(suppliedEnd).equals(encounter.getEndPeriod())) {
                throw new ConflictException("Data de alta contraditória para a mesma visita");
            }
            return;
        }
        if (allocation.getDischargedAt() != null) throw new ConflictException("Episódio sem alocação ativa");
        Bed bed = beds.lockById(allocation.getBed().getId()).orElseThrow();
        Instant end = bundle.encounter().getEndPeriod();
        if (end == null) end = EncounterRules.precise(Instant.now());
        if (end.isBefore(allocation.getAssignedAt())
                || (encounter.getStartPeriod() != null && end.isBefore(encounter.getStartPeriod()))) {
            throw new IllegalArgumentException("A alta não pode anteceder a admissão");
        }
        if (encounter.getClinicalDischargeAt() != null && end.isBefore(encounter.getClinicalDischargeAt())) {
            throw new IllegalArgumentException("A alta administrativa não pode anteceder a alta clínica");
        }
        encounter.setStatus(EncounterStatus.FINISHED);
        encounter.setEndPeriod(end);
        encounters.save(encounter);
        locations.closeAllocation(encounter.getId(), end);
        locations.updateBedStatus(bed.getId(), BedStatus.CLEANING);
        bed.setStatusReason(null);
        changes.changed("PATIENT_DISCHARGED","ENCOUNTER",encounter.getId());
    }
}
