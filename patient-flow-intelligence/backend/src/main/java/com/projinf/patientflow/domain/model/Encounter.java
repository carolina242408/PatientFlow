package com.projinf.patientflow.domain.model;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "encounters")
public class Encounter {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "visit_number", nullable = false, unique = true)
    private String visitNumber;

    /** Preenchido pela estratégia ao associar o paciente. */
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "patient_id")
    private Patient patient;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private EncounterStatus status;

    @Column(name = "start_period")
    private Instant startPeriod;

    @Column(name = "end_period")
    private Instant endPeriod;

    @Version
    private long version;

    @Column(name = "expected_discharge_at")
    private Instant expectedDischargeAt;

    @Column(name = "clinical_discharge_at")
    private Instant clinicalDischargeAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "service_id")
    private ClinicalService service;

    public long getVersion() { return version; }
    public Instant getExpectedDischargeAt() { return expectedDischargeAt; }
    public void setExpectedDischargeAt(Instant value) { expectedDischargeAt = value; }
    public Instant getClinicalDischargeAt() { return clinicalDischargeAt; }
    public void setClinicalDischargeAt(Instant value) { clinicalDischargeAt = value; }
    public ClinicalService getService() { return service; }
    public void setService(ClinicalService value) { service = value; }

    public UUID getId() { return id; }

    public void setId(UUID id) { this.id = id; }

    public String getVisitNumber() { return visitNumber; }

    public void setVisitNumber(String visitNumber) { this.visitNumber = visitNumber; }

    public Patient getPatient() { return patient; }

    public void setPatient(Patient patient) { this.patient = patient; }

    public EncounterStatus getStatus() { return status; }

    public void setStatus(EncounterStatus status) { this.status = status; }

    public Instant getStartPeriod() { return startPeriod; }

    public void setStartPeriod(Instant startPeriod) { this.startPeriod = startPeriod; }

    public Instant getEndPeriod() { return endPeriod; }

    public void setEndPeriod(Instant endPeriod) { this.endPeriod = endPeriod; }
}
