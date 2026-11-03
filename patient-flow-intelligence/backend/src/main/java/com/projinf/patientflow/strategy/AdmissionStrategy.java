package com.projinf.patientflow.strategy;

import com.projinf.patientflow.domain.model.Bed;
import com.projinf.patientflow.domain.model.BedStatus;
import com.projinf.patientflow.domain.model.Encounter;
import com.projinf.patientflow.domain.model.EncounterStatus;
import com.projinf.patientflow.domain.model.LocationAllocation;
import com.projinf.patientflow.domain.model.Patient;
import com.projinf.patientflow.dto.ParsedBundleDTO;
import com.projinf.patientflow.dto.ParsedLocationDTO;
import com.projinf.patientflow.exception.ConflictException;
import com.projinf.patientflow.exception.ResourceNotFoundException;
import com.projinf.patientflow.repository.IEncounterRepository;
import com.projinf.patientflow.repository.ILocationRepository;
import com.projinf.patientflow.repository.IPatientRepository;
import com.projinf.patientflow.repository.jpa.BedJpaRepository;
import com.projinf.patientflow.repository.jpa.LocationAllocationJpaRepository;
import com.projinf.patientflow.repository.jpa.EncounterJpaRepository;
import com.projinf.patientflow.service.EncounterRules;
import java.time.Instant;
import com.projinf.patientflow.event.ChangePublisher;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component("in-progress")
public class AdmissionStrategy implements IEncounterStrategy {
    private final ChangePublisher changes;
    private final IPatientRepository patients;
    private final IEncounterRepository encounters;
    private final ILocationRepository locations;
    private final BedJpaRepository beds;
    private final LocationAllocationJpaRepository allocations;
    private final EncounterJpaRepository encounterJpa;

    public AdmissionStrategy(IPatientRepository patients, IEncounterRepository encounters, ILocationRepository locations,
            BedJpaRepository beds, LocationAllocationJpaRepository allocations,
            EncounterJpaRepository encounterJpa, ChangePublisher changes) {
        this.changes=changes;
        this.patients = patients;
        this.encounters = encounters;
        this.locations = locations;
        this.beds = beds;
        this.allocations = allocations;
        this.encounterJpa = encounterJpa;
    }

    @Override
    @Transactional
    public void process(ParsedBundleDTO bundle) {
        Encounter encounter = bundle.encounter();
        var existing = encounters.findByVisitNumber(encounter.getVisitNumber());
        if (existing.isPresent()) {
            var allocation = allocations.findFirstByEncounterIdOrderByAssignedAtDesc(existing.get().getId())
                .orElseThrow(() -> new ConflictException("Episódio sem histórico de alocação"));
            EncounterRules.sameEpisode(bundle, existing.get(), allocation);
            return; // Equivalent duplicate or delayed admission after discharge: never reopen it.
        }
        ParsedLocationDTO location = bundle.location();
        Bed bed = beds.lockByHierarchy(location.wardCode(), location.roomCode(), location.bedCode())
            .orElseThrow(() -> new ResourceNotFoundException("Cama não encontrada na hierarquia indicada"));
        if (bed.getStatus() != BedStatus.AVAILABLE) throw new ConflictException("Cama indisponível");

        Patient patient = patients.findBySns(bundle.patient().getSnsNumber())
            .orElseGet(() -> patients.save(bundle.patient()));
        if (encounterJpa.existsByPatientIdAndStatus(patient.getId(), EncounterStatus.IN_PROGRESS)) {
            throw new ConflictException("Doente já tem um episódio de internamento ativo");
        }
        encounter.setPatient(patient);
        encounter.setService(bed.getRoom().getWard().getService());
        if (encounter.getStartPeriod() == null) encounter.setStartPeriod(EncounterRules.precise(Instant.now()));
        Encounter savedEncounter = encounters.save(encounter);
        locations.updateBedStatus(bed.getId(), BedStatus.OCCUPIED);
        bed.setStatusReason(null);

        LocationAllocation allocation = new LocationAllocation();
        allocation.setEncounter(savedEncounter);
        allocation.setBed(bed);
        allocation.setAssignedAt(encounter.getStartPeriod());
        locations.createAllocation(allocation);
        changes.changed("PATIENT_ADMITTED","ENCOUNTER",savedEncounter.getId());
    }
}
