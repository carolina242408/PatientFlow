package com.projinf.patientflow.ingestion.service;

import com.projinf.patientflow.ingestion.client.HapiFhirClient;
import com.projinf.patientflow.ingestion.client.HapiFhirClient.HapiStoreResponse;
import com.projinf.patientflow.ingestion.converter.Hl7ToFhirConverter;
import com.projinf.patientflow.ingestion.service.PostgresFhirIngestionService.PostgresIngestionResult;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Core ingestion pipeline service:
 * 1. Inspects incoming messages from subscribed APIs or HTTP endpoints.
 * 2. Converts raw or wrapped HL7 v2 messages into FHIR Bundles via
 * {@link Hl7ToFhirConverter}.
 * 3. Persists the FHIR contents into HAPI FHIR (Data Lake) via
 * {@link HapiFhirClient}.
 * 4. Transforms the FHIR Bundle into JSONB and executes the PostgreSQL stored
 * procedure
 * {@code sp_ingest_fhir_payload(jsonb)} via
 * {@link PostgresFhirIngestionService}.
 */
@Service
public class IngestionPipelineService {

    private static final Logger log = LoggerFactory.getLogger(IngestionPipelineService.class);

    public record IngestionOutcome(
            String source,
            boolean convertedFromHl7,
            boolean storedInHapi,
            int hapiStatusCode,
            int resourceCount,
            boolean storedInPostgres,
            PostgresIngestionResult postgresResult,
            JsonNode fhirBundle,
            String detail) {
        public IngestionOutcome(
                String source,
                boolean convertedFromHl7,
                boolean storedInHapi,
                int hapiStatusCode,
                int resourceCount,
                JsonNode fhirBundle,
                String detail) {
            this(source, convertedFromHl7, storedInHapi, hapiStatusCode, resourceCount, false, null, fhirBundle,
                    detail);
        }
    }

    public record PipelineMetrics(
            long totalReceived,
            long convertedFromHl7,
            long storedInHapi,
            long storedInPostgres,
            long failed,
            Instant lastIngestedAt) {
    }

    private final Hl7ToFhirConverter converter;
    private final HapiFhirClient hapiClient;
    private final PostgresFhirIngestionService postgresIngestion;
    private final JsonMapper json;

    private final AtomicLong totalReceived = new AtomicLong();
    private final AtomicLong convertedFromHl7 = new AtomicLong();
    private final AtomicLong storedInHapi = new AtomicLong();
    private final AtomicLong storedInPostgres = new AtomicLong();
    private final AtomicLong failed = new AtomicLong();
    private final AtomicReference<Instant> lastIngestedAt = new AtomicReference<>();

    @Autowired
    public IngestionPipelineService(
            Hl7ToFhirConverter converter,
            HapiFhirClient hapiClient,
            PostgresFhirIngestionService postgresIngestion,
            JsonMapper json) {
        this.converter = converter;
        this.hapiClient = hapiClient;
        this.postgresIngestion = postgresIngestion;
        this.json = json;
    }

    public IngestionPipelineService(
            Hl7ToFhirConverter converter,
            HapiFhirClient hapiClient,
            JsonMapper json) {
        this(converter, hapiClient, null, json);
    }

    public IngestionOutcome process(String rawPayload, String source) {
        totalReceived.incrementAndGet();
        if (rawPayload == null || rawPayload.isBlank()) {
            failed.incrementAndGet();
            throw new IllegalArgumentException("Ingestion payload cannot be empty");
        }

        String trimmed = rawPayload.trim();
        try {
            if (converter.isHl7Message(trimmed)) {
                Instant eventTime = FhirToPostgresTransformer.extractEventTimestampFromHl7(trimmed);
                String trigger = FhirToPostgresTransformer.extractTriggerFromHl7(trimmed);
                ObjectNode bundle = converter.convert(trimmed);
                convertedFromHl7.incrementAndGet();
                return storeBundle(bundle, source, true, eventTime, trigger);
            }

            JsonNode node = json.readTree(trimmed);
            return processJson(node, source);
        } catch (RuntimeException ex) {
            failed.incrementAndGet();
            log.warn("Ingestion failed from source {}: {}", source, ex.getMessage());
            throw ex;
        }
    }

    public IngestionOutcome processJson(JsonNode node, String source) {
        if (node == null || !node.isObject()) {
            throw new IllegalArgumentException("JSON payload must be a JSON object");
        }

        // Case 1: JSON wrapper containing an "hl7" field (e.g. SSE event from
        // data-generator /api/hl7/live)
        JsonNode hl7Field = node.path("hl7");
        if (hl7Field.isString() && !hl7Field.asString().isBlank()) {
            String rawHl7 = hl7Field.asString();
            Instant eventTime = extractWrapperEventTime(node, rawHl7);
            String trigger = node.path("trigger").asString("").trim();
            if (trigger.isEmpty()) {
                trigger = FhirToPostgresTransformer.extractTriggerFromHl7(rawHl7);
            }
            ObjectNode bundle = converter.convert(rawHl7);
            convertedFromHl7.incrementAndGet();
            return storeBundle(bundle, source, true, eventTime, trigger);
        }

        // Case 2: Already a FHIR Bundle
        String resourceType = node.path("resourceType").asString("");
        if ("Bundle".equals(resourceType)) {
            return storeBundle(node, source, false, null, null);
        }

        // Case 3: Single FHIR Resource (wrap into a collection Bundle)
        if (!resourceType.isEmpty()) {
            ObjectNode wrapper = json.createObjectNode();
            wrapper.put("resourceType", "Bundle");
            wrapper.put("type", "collection");
            wrapper.putArray("entry").addObject().set("resource", node);
            return storeBundle(wrapper, source, false, null, null);
        }

        throw new IllegalArgumentException("Unsupported JSON payload: expected 'hl7' field or FHIR 'resourceType'");
    }

    private static Instant extractWrapperEventTime(JsonNode wrapper, String rawHl7) {
        String occurred = FhirToPostgresTransformer.normalizeIsoTimestamp(wrapper.path("occurred").asString(""));
        if (occurred != null) {
            try {
                return Instant.parse(occurred);
            } catch (Exception ignored) {
            }
        }
        String mshTime = FhirToPostgresTransformer.normalizeIsoTimestamp(wrapper.path("msh_time").asString(""));
        if (mshTime != null) {
            try {
                return Instant.parse(mshTime);
            } catch (Exception ignored) {
            }
        }
        return FhirToPostgresTransformer.extractEventTimestampFromHl7(rawHl7);
    }

    private IngestionOutcome storeBundle(
            JsonNode bundle,
            String source,
            boolean wasConverted,
            Instant eventTime,
            String trigger) {
        // 1. Store raw/normalized FHIR transaction bundle in HAPI FHIR (Data Lake)
        HapiStoreResponse hapiRes = hapiClient.storeBundle(bundle);
        if (hapiRes.stored()) {
            storedInHapi.incrementAndGet();
        }

        // 2. Transform FHIR Bundle -> JSONB and execute PostgreSQL Stored Procedure
        PostgresIngestionResult pgRes = null;
        boolean pgStored = false;
        if (postgresIngestion != null) {
            try {
                pgRes = postgresIngestion.ingestFhirBundle(bundle, source, eventTime, trigger);
                pgStored = pgRes.stored();
                if (pgStored) {
                    storedInPostgres.incrementAndGet();
                    log.info("Ingested event [trigger={}] from {}: HAPI={} (HTTP {}), Postgres={}",
                            trigger != null ? trigger : "BUNDLE", source, hapiRes.stored(), hapiRes.statusCode(),
                            pgRes.detail());
                    try {
                        postgresIngestion.predictDischarge(bundle, pgRes);
                    } catch (Exception ex) {
                        log.warn("Discharge prediction failed; admission preserved");
                    }
                }
            } catch (Exception ex) {
                log.warn("Failed to persist FHIR bundle into PostgreSQL via stored procedure (source={}): {}",
                        source, ex.getMessage());
                pgRes = PostgresIngestionResult.empty("Postgres stored procedure error: " + ex.getMessage());
            }
        }

        if (hapiRes.stored() || pgStored) {
            lastIngestedAt.set(Instant.now());
        } else {
            failed.incrementAndGet();
        }

        String combinedDetail = pgRes != null
                ? hapiRes.detail() + " | " + pgRes.detail()
                : hapiRes.detail();

        return new IngestionOutcome(
                source,
                wasConverted,
                hapiRes.stored(),
                hapiRes.statusCode(),
                hapiRes.resourceCount(),
                pgStored,
                pgRes,
                bundle,
                combinedDetail);
    }

    public PipelineMetrics metrics() {
        return new PipelineMetrics(
                totalReceived.get(),
                convertedFromHl7.get(),
                storedInHapi.get(),
                storedInPostgres.get(),
                failed.get(),
                lastIngestedAt.get());
    }

    public List<PostgresFhirIngestionService.SyncWatermark> watermarks() {
        if (postgresIngestion == null) {
            return List.of();
        }
        try {
            return postgresIngestion.watermarks();
        } catch (Exception ex) {
            log.debug("Could not query fhir_sync_watermarks: {}", ex.getMessage());
            return List.of();
        }
    }
}
