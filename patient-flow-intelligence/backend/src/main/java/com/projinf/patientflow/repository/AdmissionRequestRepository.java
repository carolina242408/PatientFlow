package com.projinf.patientflow.repository;

import com.projinf.patientflow.dto.OperationalDTO.*;
import com.projinf.patientflow.exception.ResourceNotFoundException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Repository
@Transactional(propagation = Propagation.MANDATORY)
public class AdmissionRequestRepository {
    private final JdbcTemplate jdbc;
    private final OperationalQueries queries;
    public AdmissionRequestRepository(JdbcTemplate jdbc, OperationalQueries queries) { this.jdbc = jdbc; this.queries = queries; }

    public AdmissionRequestView lock(UUID id) {
        if (jdbc.query("SELECT id FROM admission_requests WHERE id=? FOR UPDATE", (r, n) -> r.getObject(1, UUID.class), id).isEmpty()) {
            throw new ResourceNotFoundException("Pedido de admissão não encontrado");
        }
        return queries.request(id);
    }

    public UUID create(AdmissionRequestWrite input, Instant requestedAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
            INSERT INTO admission_requests (id, request_number, patient_id, service_id, origin, priority,
                requested_at, desired_admission_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'WAITING')
            """, id, input.requestNumber().trim(), input.patientId(), input.serviceId(), input.origin().name(),
            input.priority(), timestamp(requestedAt), timestamp(input.desiredAdmissionAt()));
        return id;
    }

    public void update(UUID id, AdmissionRequestUpdate input) {
        jdbc.update("UPDATE admission_requests SET priority=?, desired_admission_at=?, version=version+1 WHERE id=?",
            input.priority(), timestamp(input.desiredAdmissionAt()), id);
    }

    public void close(UUID id, RequestStatus status, UUID encounterId, Instant at) {
        jdbc.update("UPDATE admission_requests SET status=?, encounter_id=?, closed_at=?, version=version+1 WHERE id=?",
            status.name(), encounterId, timestamp(at), id);
    }

    private Timestamp timestamp(Instant value) { return value == null ? null : Timestamp.from(value); }
}
