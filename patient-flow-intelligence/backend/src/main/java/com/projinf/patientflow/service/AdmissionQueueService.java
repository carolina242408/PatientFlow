package com.projinf.patientflow.service;

import com.projinf.patientflow.domain.model.*;
import com.projinf.patientflow.dto.OperationalDTO.*;
import com.projinf.patientflow.dto.ParsedBundleDTO;
import com.projinf.patientflow.dto.ParsedLocationDTO;
import com.projinf.patientflow.exception.ConflictException;
import com.projinf.patientflow.exception.ResourceNotFoundException;
import com.projinf.patientflow.repository.AdmissionRequestRepository;
import com.projinf.patientflow.repository.OperationalQueries;
import com.projinf.patientflow.repository.jpa.EncounterJpaRepository;
import jakarta.persistence.EntityManager;
import com.projinf.patientflow.security.AccessPolicy;
import java.time.Instant;
import java.util.UUID;
import com.projinf.patientflow.event.ChangePublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional
public class AdmissionQueueService {
    private final ChangePublisher changes;
    private final AdmissionRequestRepository requests;
    private final OperationalQueries queries;
    private final EntityManager entities;
    private final EncounterIngestionService ingestion;
    private final EncounterJpaRepository encounters;
    private final OperationLocks locks;
    private final AccessPolicy access;

    public AdmissionQueueService(AdmissionRequestRepository requests, OperationalQueries queries, EntityManager entities,
            EncounterIngestionService ingestion, EncounterJpaRepository encounters, OperationLocks locks, AccessPolicy access, ChangePublisher changes) {
        this.changes=changes;
        this.access=access;
        this.requests = requests; this.queries = queries; this.entities = entities;
        this.ingestion = ingestion; this.encounters = encounters; this.locks = locks;
    }

    public AdmissionRequestView create(AdmissionRequestWrite input) {
        access.service(input.serviceId());
        var patient = queries.patient(input.patientId());
        locks.patient(patient.snsNumber());
        if (entities.find(ClinicalService.class, input.serviceId()) == null) throw new ResourceNotFoundException("Serviço não encontrado");
        Instant requestedAt = input.requestedAt() == null ? EncounterRules.precise(Instant.now()) : EncounterRules.precise(input.requestedAt());
        if (requestedAt.isAfter(Instant.now())) throw new IllegalArgumentException("Pedido não pode ter data de criação futura");
        desired(requestedAt, input.desiredAdmissionAt());
        UUID id = requests.create(input, requestedAt);
        changes.changed("ADMISSION_REQUEST_CREATED","ADMISSION_REQUEST",id);
        return queries.request(id);
    }

    public AdmissionRequestView update(UUID id, AdmissionRequestUpdate input) {
        var request = lockedRequest(id);
        EncounterRules.version(request.version(), input.version());
        waiting(request);
        desired(request.requestedAt(), input.desiredAdmissionAt());
        requests.update(id, input);
        changes.changed("ADMISSION_REQUEST_UPDATED","ADMISSION_REQUEST",id);
        return queries.request(id);
    }

    public AdmissionRequestView cancel(UUID id, long version) {
        var request = lockedRequest(id);
        if (request.status() == RequestStatus.CANCELLED) return request;
        EncounterRules.version(request.version(), version);
        waiting(request);
        requests.close(id, RequestStatus.CANCELLED, null, EncounterRules.precise(Instant.now()));
        changes.changed("ADMISSION_REQUEST_CANCELLED","ADMISSION_REQUEST",id);
        return queries.request(id);
    }

    public AdmissionRequestView admit(UUID id, QueueAdmission input) {
        String visit = input.visitNumber().trim();
        locks.visit(visit);
        var request = lockedRequest(id);
        if (request.status() == RequestStatus.ADMITTED) {
            var stored = queries.encounter(request.encounterId());
            if (stored.visitNumber().equals(visit) && input.bedId().equals(stored.bedId())
                    && (input.admittedAt() == null || EncounterRules.precise(input.admittedAt()).equals(stored.admittedAt()))) {
                return request;
            }
            throw new ConflictException("Pedido já admitido com outros dados");
        }
        EncounterRules.version(request.version(), input.version());
        waiting(request);
        Instant admittedAt = input.admittedAt() == null ? EncounterRules.precise(Instant.now()) : EncounterRules.precise(input.admittedAt());
        if (admittedAt.isBefore(request.requestedAt())) throw new IllegalArgumentException("Admissão não pode anteceder o pedido");
        var bed = queries.bed(input.bedId());
        if (!request.serviceId().equals(bed.serviceId())) throw new ConflictException("Cama não pertence ao serviço solicitado");
        // A queue action must create a new stay, rather than attach a request to an old/discharged visit.
        if (encounters.findByVisitNumber(visit).isPresent()) throw new ConflictException("Número de visita já registado");
        Encounter encounter = new Encounter();
        encounter.setVisitNumber(visit); encounter.setStatus(EncounterStatus.IN_PROGRESS); encounter.setStartPeriod(admittedAt);
        Patient entity = entities.find(Patient.class, request.patientId());
        ingestion.ingest(new ParsedBundleDTO(entity, encounter,
            new ParsedLocationDTO(bed.wardCode(), bed.roomCode(), bed.code())));
        entities.flush();
        UUID encounterId = encounters.findByVisitNumber(visit).orElseThrow().getId();
        requests.close(id, RequestStatus.ADMITTED, encounterId, admittedAt);
        changes.changed("ADMISSION_REQUEST_ADMITTED","ADMISSION_REQUEST",id);
        return queries.request(id);
    }

    private void waiting(AdmissionRequestView request) {
        if (request.status() != RequestStatus.WAITING) throw new ConflictException("Pedido já encerrado");
    }

    private AdmissionRequestView lockedRequest(UUID id) {
        var snapshot = queries.request(id);
        locks.patient(queries.patient(snapshot.patientId()).snsNumber());
        return requests.lock(id);
    }

    private void desired(Instant requested, Instant desired) {
        if (desired != null && desired.isBefore(requested)) throw new IllegalArgumentException("Data pretendida não pode anteceder o pedido");
    }
}
