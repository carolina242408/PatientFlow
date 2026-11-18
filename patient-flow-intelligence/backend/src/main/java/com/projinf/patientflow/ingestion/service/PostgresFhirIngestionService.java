package com.projinf.patientflow.ingestion.service;

import com.projinf.patientflow.event.ChangePublisher;
import com.projinf.patientflow.repository.HierarchyRepository.Type;
import com.projinf.patientflow.security.KeycloakGroupService;
import com.projinf.patientflow.service.AlgorithmsClient;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.time.format.TextStyle;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Executes the Hybrid ETL Load phase into PostgreSQL:
 * 1. Transforms FHIR Bundles into a flexible JSONB payload via
 * {@link FhirToPostgresTransformer}.
 * 2. Calls the PostgreSQL stored function
 * {@code sp_ingest_fhir_payload(jsonb)}.
 * 3. Broadcasts resulting domain changes via {@link ChangePublisher} to
 * WebSocket subscribers.
 *
 * <p>
 * Designed to be invoked both inline by {@link IngestionPipelineService} today
 * and by
 * a future HAPI FHIR batch/watermark poller or subscription webhook without
 * modification.
 */
@Service
public class PostgresFhirIngestionService {

    private static final Logger log = LoggerFactory.getLogger(PostgresFhirIngestionService.class);

    public record EmittedEvent(
            String type,
            String resource,
            UUID id) {
    }

    public record PostgresIngestionResult(
            boolean stored,
            int locationsUpserted,
            int patientsUpserted,
            int encountersProcessed,
            int allocationsChanged,
            List<EmittedEvent> events,
            String detail) {
        public static PostgresIngestionResult empty(String detail) {
            return new PostgresIngestionResult(false, 0, 0, 0, 0, List.of(), detail);
        }
    }

    public record SyncWatermark(
            String sourceKey,
            Instant lastUpdated,
            String lastResourceId,
            long bundlesProcessed,
            Instant updatedAt) {
    }

    private final FhirToPostgresTransformer transformer;
    private final JdbcTemplate jdbc;
    private final JsonMapper json;
    private final ChangePublisher changes;
    private final KeycloakGroupService keycloakGroups;
    private final AlgorithmsClient algorithms;
    private final TransactionTemplate transactions;

    public PostgresFhirIngestionService(
            FhirToPostgresTransformer transformer,
            JdbcTemplate jdbc,
            JsonMapper json,
            ChangePublisher changes,
            KeycloakGroupService keycloakGroups,
            AlgorithmsClient algorithms,
            TransactionTemplate transactions) {
        this.transformer = transformer;
        this.jdbc = jdbc;
        this.json = json;
        this.changes = changes;
        this.keycloakGroups = keycloakGroups;
        this.algorithms = algorithms;
        this.transactions = transactions;
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
     * Transforms a FHIR Bundle into the normalized JSONB contract (including
     * optional HL7 trigger)
     * and persists it into PostgreSQL via {@code sp_ingest_fhir_payload(jsonb)}.
     */
    @Transactional
    public PostgresIngestionResult ingestFhirBundle(
            JsonNode fhirBundle,
            String source,
            Instant eventTimestamp,
            String trigger) {
        ObjectNode payload = transformer.transformBundle(fhirBundle, source, eventTimestamp, trigger);
        return executeJsonbPayload(payload);
    }

    /**
     * Directly executes the PostgreSQL stored procedure
     * {@code sp_ingest_fhir_payload(jsonb)}
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

        List<UUID> previouslyCleaningBeds = jdbc.query(
                "SELECT b.id FROM beds b WHERE b.status = 'CLEANING' "
                        + "AND NOT EXISTS (SELECT 1 FROM location_allocations la WHERE la.bed_id = b.id AND la.discharged_at IS NULL)",
                (rs, n) -> rs.getObject(1, UUID.class));

        String payloadJson = json.writeValueAsString(payload);
        String resultJson = jdbc.queryForObject(
                "SELECT sp_ingest_fhir_payload(?::jsonb)::text",
                String.class,
                payloadJson);

        if (resultJson == null || resultJson.isBlank()) {
            return PostgresIngestionResult.empty("Stored procedure returned empty response");
        }

        for (UUID cleaningBedId : previouslyCleaningBeds) {
            int updated = jdbc.update(
                    "UPDATE beds b SET status = 'AVAILABLE', status_reason = NULL, version = b.version + 1 "
                            + "WHERE b.id = ? AND b.status = 'CLEANING' "
                            + "AND NOT EXISTS (SELECT 1 FROM location_allocations la WHERE la.bed_id = b.id AND la.discharged_at IS NULL)",
                    cleaningBedId);
            if (updated > 0) {
                changes.changed("BED_STATUS_CHANGED", "BED", cleaningBedId);
            }
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
                        log.debug("Failed to publish WebSocket event {}/{}/{}: {}", type, resource, idStr,
                                ex.getMessage());
                    }
                }
            }
        }

        String detail = String.format(
                "Postgres stored procedure executed (locations=%d, patients=%d, encounters=%d, allocations=%d)",
                locationsUpserted, patientsUpserted, encountersProcessed, allocationsChanged);
        PostgresIngestionResult result = new PostgresIngestionResult(
                true,
                locationsUpserted,
                patientsUpserted,
                encountersProcessed,
                allocationsChanged,
                emitted,
                detail);

        // Sync hierarchy entries to Keycloak as groups.
        if (locationsUpserted > 0) {
            syncHierarchyToKeycloak();
        }

        return result;
    }

    /**
     * Idempotently ensures every ULS-through-WARD row in the database has a
     * corresponding Keycloak group. Called after any ingestion that upserted
     * location hierarchy rows so that freshly auto-created nodes are immediately
     * visible as groups for user assignment.
     */
    private void syncHierarchyToKeycloak() {
        // ULS (top-level, no parent)
        List<Object[]> ulsList = jdbc.query(
                "SELECT id, name FROM uls ORDER BY name, id",
                (rs, n) -> new Object[] { rs.getObject(1, UUID.class), rs.getString(2) });
        for (Object[] row : ulsList) {
            tryEnsureGroup(Type.ULS, (UUID) row[0], (String) row[1], null);
        }

        // UNIT (child of ULS)
        List<Object[]> unitList = jdbc.query(
                "SELECT u.id, u.name, u.uls_id FROM healthcare_units u ORDER BY u.name, u.id",
                (rs, n) -> new Object[] {
                        rs.getObject(1, UUID.class),
                        rs.getString(2),
                        rs.getObject(3, UUID.class)
                });
        for (Object[] row : unitList) {
            tryEnsureGroup(Type.UNIT, (UUID) row[0], (String) row[1], (UUID) row[2]);
        }

        // BUILDING (child of UNIT)
        List<Object[]> buildingList = jdbc.query(
                "SELECT b.id, b.name, b.unit_id FROM buildings b ORDER BY b.name, b.id",
                (rs, n) -> new Object[] {
                        rs.getObject(1, UUID.class),
                        rs.getString(2),
                        rs.getObject(3, UUID.class)
                });
        for (Object[] row : buildingList) {
            tryEnsureGroup(Type.BUILDING, (UUID) row[0], (String) row[1], (UUID) row[2]);
        }

        // FLOOR (child of BUILDING)
        List<Object[]> floorList = jdbc.query(
                "SELECT f.id, f.level_name, f.building_id FROM floors f ORDER BY f.level_name, f.id",
                (rs, n) -> new Object[] {
                        rs.getObject(1, UUID.class),
                        rs.getString(2),
                        rs.getObject(3, UUID.class)
                });
        for (Object[] row : floorList) {
            tryEnsureGroup(Type.FLOOR, (UUID) row[0], (String) row[1], (UUID) row[2]);
        }

        // SERVICE (child of FLOOR)
        List<Object[]> serviceList = jdbc.query(
                "SELECT s.id, s.name, s.floor_id FROM clinical_services s ORDER BY s.name, s.id",
                (rs, n) -> new Object[] {
                        rs.getObject(1, UUID.class),
                        rs.getString(2),
                        rs.getObject(3, UUID.class)
                });
        for (Object[] row : serviceList) {
            tryEnsureGroup(Type.SERVICE, (UUID) row[0], (String) row[1], (UUID) row[2]);
        }

        // WING (child of SERVICE)
        List<Object[]> wingList = jdbc.query(
                "SELECT w.id, w.name, w.service_id FROM wings w ORDER BY w.name, w.id",
                (rs, n) -> new Object[] {
                        rs.getObject(1, UUID.class),
                        rs.getString(2),
                        rs.getObject(3, UUID.class)
                });
        for (Object[] row : wingList) {
            tryEnsureGroup(Type.WING, (UUID) row[0], (String) row[1], (UUID) row[2]);
        }

        // WARD (child of WING)
        List<Object[]> wardList = jdbc.query(
                "SELECT w.id, w.name, w.wing_id FROM wards w ORDER BY w.name, w.id",
                (rs, n) -> new Object[] {
                        rs.getObject(1, UUID.class),
                        rs.getString(2),
                        rs.getObject(3, UUID.class)
                });
        for (Object[] row : wardList) {
            tryEnsureGroup(Type.WARD, (UUID) row[0], (String) row[1], (UUID) row[2]);
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
     * Trigger da previsão de alta: quando um bundle admite um paciente e traz um diagnóstico
     * ({@code Condition}), pede a previsão ao serviço algorithms e grava-a em
     * {@code encounters.expected_discharge_at}. Não sobrescreve um plano já definido.
     */
    public void predictDischarge(JsonNode fhirBundle, PostgresIngestionResult result) {
        var encounterIds = result.events().stream()
                .filter(e -> "PATIENT_ADMITTED".equals(e.type()) && "ENCOUNTER".equals(e.resource()))
                .map(EmittedEvent::id).distinct().toList();
        Map<String, JsonNode> resources = new HashMap<>();
        Map<String, JsonNode> encounters = new HashMap<>();
        for (JsonNode entry : fhirBundle.path("entry").values()) {
            JsonNode res = entry.path("resource");
            String fullUrl = entry.path("fullUrl").asString("");
            if (!fullUrl.isBlank()) resources.put(fullUrl, res);
            String id = res.path("id").asString("");
            if (!id.isBlank()) resources.put(res.path("resourceType").asString("") + "/" + id, res);
            if ("Encounter".equals(res.path("resourceType").asString(""))) {
                encounters.put(FhirToPostgresTransformer.extractVisitNumber(res), res);
            }
        }
        for (UUID encounterId : encounterIds) {
            // Read demographics from the persisted encounter's patient, never an
            // unrelated Patient/Condition elsewhere in a multi-patient bundle.
            var inputs = jdbc.query("""
                    SELECT e.visit_number, e.start_period, p.gender, p.birth_date, s.code AS service_code
                    FROM encounters e JOIN patients p ON p.id = e.patient_id
                    JOIN clinical_services s ON s.id = e.service_id
                    WHERE e.id = ? AND e.status = 'IN_PROGRESS' AND e.expected_discharge_at IS NULL
                    """, (rs, row) -> {
                JsonNode encounter = encounters.get(rs.getString("visit_number"));
                LocalDate birth = rs.getObject("birth_date", LocalDate.class);
                OffsetDateTime storedStart = rs.getObject("start_period", OffsetDateTime.class);
                if (encounter == null || birth == null || storedStart == null) return null;
                JsonNode period = encounter.has("period") ? encounter.path("period") : encounter.path("actualPeriod");
                OffsetDateTime admitted;
                try {
                    String raw = period.path("start").asString("");
                    try {
                        admitted = OffsetDateTime.parse(raw);
                    } catch (DateTimeParseException noOffset) {
                        // Same legacy convention as FhirToPostgresTransformer.
                        admitted = LocalDateTime.parse(raw).atOffset(ZoneOffset.UTC);
                    }
                } catch (DateTimeParseException invalid) {
                    return null;
                }
                if (!admitted.toInstant().equals(storedStart.toInstant()) || birth.isAfter(admitted.toLocalDate())) return null;
                String gender = switch (String.valueOf(rs.getString("gender"))) {
                    case "male" -> "M";
                    case "female" -> "F";
                    default -> null;
                };
                // Mapping defined by tools/data-generation/config/hospital.yaml.
                String specialty = switch (rs.getString("service_code")) {
                    case "30004" -> "MED";
                    case "30006" -> "CIR";
                    case "30020" -> "UCI";
                    default -> null;
                };
                String diagnosis = dischargeDiagnosis(encounter, resources);
                if (gender == null || specialty == null || diagnosis == null) return null;
                // Match the dataset notebook: floor(elapsed calendar days / 365.25).
                int age = (int) (ChronoUnit.DAYS.between(birth, admitted.toLocalDate()) / 365.25);
                if (age > 130) return null;
                int hour = admitted.getHour();
                String timePeriod = hour < 6 ? "Night" : hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";
                int monthDay = admitted.getMonthValue() * 100 + admitted.getDayOfMonth();
                String season = monthDay < 320 || monthDay >= 1221 ? "Winter"
                        : monthDay < 621 ? "Spring" : monthDay < 923 ? "Summer" : "Autumn";
                return new AlgorithmsClient.DischargeInput(gender, age, diagnosis, admitted, admitted.getMonthValue(),
                        admitted.getDayOfWeek().getDisplayName(TextStyle.FULL, Locale.ENGLISH), timePeriod, season, specialty);
            }, encounterId);
            if (inputs.isEmpty() || inputs.getFirst() == null) continue;
            persistDischargePrediction(encounterId, inputs.getFirst());
        }
    }

    private static String dischargeDiagnosis(JsonNode encounter, Map<String, JsonNode> resources) {
        Set<String> codes = new HashSet<>();
        Set<JsonNode> conditions = new HashSet<>();
        // An explicitly ranked primary diagnosis takes precedence. Otherwise only
        // use an unambiguous ICD-10 diagnosis associated with this encounter.
        for (JsonNode diagnosis : encounter.path("diagnosis").values()) {
            if (diagnosis.path("rank").asInt(0) == 1) {
                JsonNode condition = resources.get(diagnosis.path("condition").path("reference").asString(""));
                if (condition != null) conditions.add(condition);
            }
        }
        if (conditions.isEmpty()) {
            for (JsonNode resource : resources.values()) {
                if ("Condition".equals(resource.path("resourceType").asString(""))
                        && encounter.equals(resources.get(resource.path("encounter").path("reference").asString("")))) {
                    conditions.add(resource);
                }
            }
        }
        for (JsonNode condition : conditions) {
            String subject = condition.path("subject").path("reference").asString("");
            String encounterSubject = encounter.path("subject").path("reference").asString("");
            if (!subject.equals(encounterSubject)
                    && (resources.get(subject) == null || !resources.get(subject).equals(resources.get(encounterSubject)))) continue;
            for (JsonNode coding : condition.path("code").path("coding").values()) {
                if (Set.of("http://hl7.org/fhir/sid/icd-10", "http://hl7.org/fhir/sid/icd-10-cm")
                        .contains(coding.path("system").asString(""))) {
                    String code = coding.path("code").asString("").trim();
                    if (!code.isEmpty()) codes.add(code);
                }
            }
        }
        return codes.size() == 1 ? codes.iterator().next() : null;
    }

    private void persistDischargePrediction(UUID encounterId, AlgorithmsClient.DischargeInput input) {
        // HTTP stays outside the transaction. Discharge has its own model timeout.
        Instant predicted = algorithms.predictDischarge(input).orElse(null);
        if (predicted == null) {
            return;
        }
        OffsetDateTime at = predicted.atOffset(ZoneOffset.UTC);
        // HTTP fica fora da transação; só o UPDATE + evento WebSocket correm dentro dela.
        transactions.executeWithoutResult(tx -> {
            int updated = jdbc.update(
                    "UPDATE encounters SET expected_discharge_at = ?, version = version + 1 "
                            + "WHERE id = ? AND expected_discharge_at IS NULL AND status = 'IN_PROGRESS' "
                            + "AND start_period = ? AND start_period <= ?",
                    at, encounterId, input.admittedAt(), at);
            if (updated == 1) {
                changes.changed("DISCHARGE_PLAN_CHANGED", "ENCOUNTER", encounterId);
            }
        });
    }

    /**
     * Returns the current ingestion watermarks recorded in PostgreSQL, ready for
     * status monitoring
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
                            updAt != null ? updAt.toInstant() : null);
                });
    }
}
