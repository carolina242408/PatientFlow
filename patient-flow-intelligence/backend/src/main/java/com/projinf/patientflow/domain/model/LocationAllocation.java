package com.projinf.patientflow.domain.model;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "location_allocations")
public class LocationAllocation {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "encounter_id")
    private Encounter encounter;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "bed_id")
    private Bed bed;

    @Column(name = "assigned_at", nullable = false)
    private Instant assignedAt;

    @Column(name = "discharged_at")
    private Instant dischargedAt;

    public UUID getId() { return id; }

    public void setId(UUID id) { this.id = id; }

    public Encounter getEncounter() { return encounter; }

    public void setEncounter(Encounter encounter) { this.encounter = encounter; }

    public Bed getBed() { return bed; }

    public void setBed(Bed bed) { this.bed = bed; }

    public Instant getAssignedAt() { return assignedAt; }

    public void setAssignedAt(Instant assignedAt) { this.assignedAt = assignedAt; }

    public Instant getDischargedAt() { return dischargedAt; }

    public void setDischargedAt(Instant dischargedAt) { this.dischargedAt = dischargedAt; }
}
