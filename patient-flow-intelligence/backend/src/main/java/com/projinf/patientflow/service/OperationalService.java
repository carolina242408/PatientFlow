package com.projinf.patientflow.service;

import com.projinf.patientflow.domain.model.*;
import com.projinf.patientflow.dto.OperationalDTO.*;
import com.projinf.patientflow.dto.ParsedBundleDTO;
import com.projinf.patientflow.dto.ParsedLocationDTO;
import com.projinf.patientflow.exception.ConflictException;
import com.projinf.patientflow.exception.ResourceNotFoundException;
import com.projinf.patientflow.repository.OperationalQueries;
import com.projinf.patientflow.repository.jpa.BedJpaRepository;
import com.projinf.patientflow.repository.jpa.PatientJpaRepository;
import jakarta.persistence.EntityManager;
import com.projinf.patientflow.security.AccessPolicy;
import java.time.Instant;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import com.projinf.patientflow.event.ChangePublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional
public class OperationalService {
    private final ChangePublisher changes;
    private final AccessPolicy access;
    private final EntityManager entities;
    private final JdbcTemplate jdbc;
    private final OperationLocks locks;
    private final BedJpaRepository beds;
    private final PatientJpaRepository patients;
    private final OperationalQueries queries;
    private final EncounterIngestionService ingestion;

    public OperationalService(EntityManager entities, JdbcTemplate jdbc, OperationLocks locks, BedJpaRepository beds,
            PatientJpaRepository patients, OperationalQueries queries, EncounterIngestionService ingestion, AccessPolicy access, ChangePublisher changes) {
        this.changes=changes;
        this.access=access;
        this.entities = entities; this.jdbc = jdbc; this.locks = locks; this.beds = beds;
        this.patients = patients; this.queries = queries; this.ingestion = ingestion;
    }

    public PatientView createPatient(PatientWrite input) {
        access.admin();
        String sns = input.snsNumber().trim();
        locks.patient(sns);
        if (patients.findBySnsNumber(sns).isPresent()) throw new ConflictException("SNS já registado");
        Patient patient = new Patient();
        patient.setSnsNumber(sns);
        demographics(patient, input.fullName(), input.hospitalNumber(), input.birthDate(), input.gender());
        entities.persist(patient); entities.flush();
        changes.changed("PATIENT_CREATED","PATIENT",patient.getId());
        return queries.patient(patient.getId());
    }

    public PatientView updatePatient(UUID id, PatientUpdate input) {
        access.admin();
        String sns = jdbc.query("SELECT sns_number FROM patients WHERE id=?", (r, n) -> r.getString(1), id)
            .stream().findFirst().orElseThrow(() -> new ResourceNotFoundException("Doente não encontrado"));
        locks.patient(sns);
        Patient patient = require(Patient.class, id);
        EncounterRules.version(patient.getVersion(), input.version());
        demographics(patient, input.fullName(), input.hospitalNumber(), input.birthDate(), input.gender());
        entities.flush();
        if(patient.getVersion()!=input.version()) changes.changed("PATIENT_UPDATED","PATIENT",id);
        return queries.patient(id);
    }

    private void demographics(Patient patient, String name, String hospitalNumber, java.time.LocalDate birthDate, String gender) {
        patient.setFullName(name.trim());
        patient.setHospitalNumber(trim(hospitalNumber));
        patient.setBirthDate(birthDate);
        patient.setGender(gender == null ? "unknown" : gender);
    }

    public BedView changeBedState(UUID id, BedState input) {
        access.bed(id);
        Bed bed = beds.lockById(id).orElseThrow(() -> new ResourceNotFoundException("Cama não encontrada"));
        EncounterRules.version(bed.getVersion(), input.version());
        if (input.status() == BedStatus.OCCUPIED || bed.getStatus() == BedStatus.OCCUPIED) {
            throw new ConflictException("A ocupação só pode mudar por admissão ou alta");
        }
        if (jdbc.queryForObject("SELECT count(*) FROM location_allocations WHERE bed_id=? AND discharged_at IS NULL",
                Long.class, id) > 0) throw new ConflictException("Cama com alocação ativa");
        String reason = trim(input.reason());
        if (input.status() == BedStatus.BLOCKED && reason == null) throw new IllegalArgumentException("Motivo obrigatório para bloquear a cama");
        bed.setStatus(input.status());
        bed.setStatusReason(input.status() == BedStatus.AVAILABLE ? null : reason);
        entities.flush();
        if(bed.getVersion()!=input.version()) changes.changed("BED_STATUS_CHANGED","BED",id);
        return queries.bed(id);
    }

    public EncounterView planDischarge(UUID id, DischargePlan input) {
        Encounter encounter = lockedEncounter(id);
        EncounterRules.version(encounter.getVersion(), input.version());
        active(encounter);
        Instant at = EncounterRules.precise(input.expectedDischargeAt());
        afterAdmission(encounter, at);
        encounter.setExpectedDischargeAt(at);
        entities.flush();
        if(encounter.getVersion()!=input.version()) changes.changed("DISCHARGE_PLAN_CHANGED","ENCOUNTER",id);
        return queries.encounter(id);
    }

    public EncounterView clinicalDischarge(UUID id, DischargeAction input) {
        Encounter encounter = lockedEncounter(id);
        if (encounter.getClinicalDischargeAt() != null) {
            if (input.at() == null || encounter.getClinicalDischargeAt().equals(EncounterRules.precise(input.at()))) {
                return queries.encounter(id);
            }
            throw new ConflictException("Alta clínica já registada com outra data");
        }
        EncounterRules.version(encounter.getVersion(), input.version());
        active(encounter);
        Instant at = input.at() == null ? EncounterRules.precise(Instant.now()) : EncounterRules.precise(input.at());
        afterAdmission(encounter, at);
        encounter.setClinicalDischargeAt(at);
        entities.flush();
        changes.changed("CLINICAL_DISCHARGE_RECORDED","ENCOUNTER",id);
        return queries.encounter(id);
    }

    public EncounterView administrativeDischarge(UUID id, DischargeAction input) {
        Encounter encounter = lockedEncounter(id);
        if (encounter.getStatus() == EncounterStatus.FINISHED) {
            if (input.at() == null || encounter.getEndPeriod().equals(EncounterRules.precise(input.at()))) {
                return queries.encounter(id);
            }
            throw new ConflictException("Alta administrativa já registada com outra data");
        }
        EncounterRules.version(encounter.getVersion(), input.version());
        var current = queries.encounter(id);
        if (current.bedId() == null) throw new ConflictException("Episódio sem alocação");
        var bed = queries.bed(current.bedId());
        Encounter incoming = new Encounter();
        incoming.setVisitNumber(encounter.getVisitNumber());
        incoming.setStatus(EncounterStatus.FINISHED);
        incoming.setEndPeriod(EncounterRules.precise(input.at()));
        ingestion.ingest(new ParsedBundleDTO(encounter.getPatient(), incoming,
            new ParsedLocationDTO(bed.wardCode(), bed.roomCode(), bed.code())));
        entities.flush();
        return queries.encounter(id);
    }

    private Encounter lockedEncounter(UUID id) {
        access.encounter(id);
        String visit = jdbc.query("SELECT visit_number FROM encounters WHERE id=?", (r, n) -> r.getString(1), id)
            .stream().findFirst().orElseThrow(() -> new ResourceNotFoundException("Episódio não encontrado"));
        locks.visit(visit);
        return require(Encounter.class, id);
    }

    private void active(Encounter encounter) {
        if (encounter.getStatus() != EncounterStatus.IN_PROGRESS) throw new ConflictException("Episódio já terminado");
    }

    private void afterAdmission(Encounter encounter, Instant at) {
        if (at != null && encounter.getStartPeriod() != null && at.isBefore(encounter.getStartPeriod())) {
            throw new IllegalArgumentException("Data não pode anteceder a admissão");
        }
    }

    private <T> T require(Class<T> type, UUID id) {
        T entity = entities.find(type, id);
        if (entity == null) throw new ResourceNotFoundException("Recurso não encontrado");
        return entity;
    }

    private String trim(String value) { return value == null || value.isBlank() ? null : value.trim(); }
}
