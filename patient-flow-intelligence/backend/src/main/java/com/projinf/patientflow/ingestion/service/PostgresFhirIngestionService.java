package com.projinf.patientflow.ingestion.service;

import com.projinf.patientflow.event.ChangePublisher;
import com.projinf.patientflow.repository.HierarchyRepository.Type;
import com.projinf.patientflow.security.KeycloakGroupService;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Executes the Hybrid ETL Load phase into PostgreSQL:
 * 1. Transforms FHIR Bundles into a flexible JSONB payload via {@link FhirToPostgresTransformer}.
 * 2. Calls the PostgreSQL stored function {@code sp_ingest_fhir_payload(jsonb)}.
 * 3. Broadcasts resulting domain changes via {@link ChangePublisher} to WebSocket subscribers.
 *
 * <p>Designed to be invoked both inline by {@link IngestionPipelineService} today and by
 * a future HAPI FHIR batch/watermark poller or subscription webhook without modification.
 */
@Service
public class PostgresFhirIngestionService {

    private static final Logger log = LoggerFactory.getLogger(PostgresFhirIngestionService.class);

    public record EmittedEvent(
            String type,
            String resource,
            UUID id
    ) {
    }

    public record PostgresIngestionResult(
            boolean stored,
            int locationsUpserted,
            int patientsUpserted,
            int encountersProcessed,
            int allocationsChanged,
            List<EmittedEvent> events,
            String detail
    ) {
        public static PostgresIngestionResult empty(String detail) {
            return new PostgresIngestionResult(false, 0, 0, 0, 0, List.of(), detail);
        }
    }

    public record SyncWatermark(
            String sourceKey,
            Instant lastUpdated,
            String lastResourceId,
            long bundlesProcessed,
            Instant updatedAt
    ) {
    }

    private final FhirToPostgresTransformer transformer;
    private final JdbcTemplate jdbc;
    private final JsonMapper json;
    private final ChangePublisher changes;
    private final KeycloakGroupService keycloakGroups;

    public PostgresFhirIngestionService(
            FhirToPostgresTransformer transformer,
            JdbcTemplate jdbc,
            JsonMapper json,
            ChangePublisher changes,
            KeycloakGroupService keycloakGroups
    ) {
        this.transformer = transformer;
        this.jdbc = jdbc;
        this.json = json;
        this.changes = changes;
        this.keycloakGroups = keycloakGroups;
    }

    /**
     * Transforms a FHIR Bundle into the normalized JSONB contract and persists it
     * into PostgreSQL via {@code sp_ingest_fhir_payload(jsonb)}.
     */
    @Transactional
    public PostgresIngestionResult ingestFhirBundle(JsonNode fhirBundle, String source, Instant eventTimestamp) {
        return ingestFhirBundle(fhirBundle, source, eventTimestamp, null);
    }

    /**
     * Transforms a FHIR Bundle into the normalized JSONB contract (including optional HL7 trigger)
     * and persists it into PostgreSQL via {@code sp_ingest_fhir_payload(jsonb)}.
     */
    @Transactional
    public PostgresIngestionResult ingestFhirBundle(
            JsonNode fhirBundle,
            String source,
            Instant eventTimestamp,
            String trigger
    ) {
        ObjectNode payload = transformer.transformBundle(fhirBundle, source, eventTimestamp, trigger);
        return executeJsonbPayload(payload);
    }

    /**
     * Directly executes the PostgreSQL stored procedure {@code sp_ingest_fhir_payload(jsonb)}
     * with a pre-constructed JSONB payload and publishes any emitted domain events.
     */
    @Transactional
    public PostgresIngestionResult executeJsonbPayload(JsonNode payload) {
        if (payload == null || !payload.isObject()) {
            return PostgresIngestionResult.empty("Payload must be a JSON object");
        }

        int locCount = payload.path("locations").size();
        int patCount = payload.path("patients").size();
        int encCount = payload.path("encounters").size();
        if (locCount == 0 && patCount == 0 && encCount == 0) {
            return new PostgresIngestionResult(true, 0, 0, 0, 0, List.of(), "No actionable resources in bundle");
        }

        String payloadJson = json.writeValueAsString(payload);
        String resultJson = jdbc.queryForObject(
                "SELECT sp_ingest_fhir_payload(?::jsonb)::text",
                String.class,
                payloadJson
        );

        if (resultJson == null || resultJson.isBlank()) {
            return PostgresIngestionResult.empty("Stored procedure returned empty response");
        }

        JsonNode res = json.readTree(resultJson);
        int locationsUpserted = res.path("locationsUpserted").asInt(0);
        int patientsUpserted = res.path("patientsUpserted").asInt(0);
        int encountersProcessed = res.path("encountersProcessed").asInt(0);
        int allocationsChanged = res.path("allocationsChanged").asInt(0);

        List<EmittedEvent> emitted = new ArrayList<>();
        JsonNode eventsNode = res.path("events");
        if (eventsNode.isArray()) {
            for (JsonNode ev : eventsNode.values()) {
                String type = ev.path("type").asString("");
                String resource = ev.path("resource").asString("");
                String idStr = ev.path("id").asString("");
                if (!type.isEmpty() && !resource.isEmpty() && !idStr.isEmpty()) {
                    try {
                        UUID id = UUID.fromString(idStr);
                        emitted.add(new EmittedEvent(type, resource, id));
                        changes.changed(type, resource, id);
                    } catch (Exception ex) {
                        log.debug("Failed to publish WebSocket event {}/{}/{}: {}", type, resource, idStr, ex.getMessage());
                    }
                }
            }
        }

        String detail = String.format(
                "Postgres stored procedure executed (locations=%d, patients=%d, encounters=%d, allocations=%d)",
                locationsUpserted, patientsUpserted, encountersProcessed, allocationsChanged
        );
        PostgresIngestionResult result = new PostgresIngestionResult(
                true,
                locationsUpserted,
                patientsUpserted,
                encountersProcessed,
                allocationsChanged,
                emitted,
                detail
        );

        // Sync newly created ULS / UNIT / SERVICE entries to Keycloak as groups
        if (locationsUpserted > 0) {
            syncHierarchyToKeycloak();
        }

        return result;
    }

    /**
     * Idempotently ensures every ULS, UNIT, and SERVICE row in the database has a
     * corresponding Keycloak group.  Called after any ingestion that upserted
     * location hierarchy rows so that freshly auto-created nodes are immediately
     * visible as groups for user assignment.
     */
    private void syncHierarchyToKeycloak() {
        // ULS (top-level, no parent)
        List<Object[]> ulsList = jdbc.query(
                "SELECT id, name FROM uls ORDER BY name, id",
                (rs, n) -> new Object[]{rs.getObject(1, UUID.class), rs.getString(2)}
        );
        for (Object[] row : ulsList) {
            tryEnsureGroup(Type.ULS, (UUID) row[0], (String) row[1], null);
        }

        // UNIT (child of ULS)
        List<Object[]> unitList = jdbc.query(
                "SELECT u.id, u.name, u.uls_id FROM healthcare_units u ORDER BY u.name, u.id",
                (rs, n) -> new Object[]{
                        rs.getObject(1, UUID.class),
                        rs.getString(2),
                        rs.getObject(3, UUID.class)
                }
        );
        for (Object[] row : unitList) {
            tryEnsureGroup(Type.UNIT, (UUID) row[0], (String) row[1], (UUID) row[2]);
        }

        // SERVICE (child of UNIT, resolved through floor → building → unit)
        List<Object[]> serviceList = jdbc.query(
                "SELECT s.id, s.name, b.unit_id "
                + "FROM clinical_services s "
                + "JOIN floors f ON f.id = s.floor_id "
                + "JOIN buildings b ON b.id = f.building_id "
                + "ORDER BY s.name, s.id",
                (rs, n) -> new Object[]{
                        rs.getObject(1, UUID.class),
                        rs.getString(2),
                        rs.getObject(3, UUID.class)
                }
        );
        for (Object[] row : serviceList) {
            tryEnsureGroup(Type.SERVICE, (UUID) row[0], (String) row[1], (UUID) row[2]);
        }
    }

    private void tryEnsureGroup(Type type, UUID id, String name, UUID parentId) {
        try {
            keycloakGroups.ensureHierarchyGroup(type, id, name, parentId);
        } catch (Exception ex) {
            log.warn("Failed to sync Keycloak group for {}/{} ({}): {}", type, id, name, ex.getMessage());
        }
    }

    /**
     * Returns the current ingestion watermarks recorded in PostgreSQL, ready for status monitoring
     * and future HAPI FHIR batch synchronization.
     */
    @Transactional(readOnly = true)
    public List<SyncWatermark> watermarks() {
        return jdbc.query(
                "SELECT source_key, last_updated, last_resource_id, bundles_processed, updated_at "
                        + "FROM fhir_sync_watermarks ORDER BY updated_at DESC",
                (rs, rowNum) -> {
                    OffsetDateTime lastUpd = rs.getObject("last_updated", OffsetDateTime.class);
                    OffsetDateTime updAt = rs.getObject("updated_at", OffsetDateTime.class);
                    return new SyncWatermark(
                            rs.getString("source_key"),
                            lastUpd != null ? lastUpd.toInstant() : null,
                            rs.getString("last_resource_id"),
                            rs.getLong("bundles_processed"),
                            updAt != null ? updAt.toInstant() : null
                    );
                }
        );
    }
}

