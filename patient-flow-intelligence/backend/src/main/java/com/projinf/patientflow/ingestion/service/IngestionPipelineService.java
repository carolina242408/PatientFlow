package com.projinf.patientflow.ingestion.service;

import com.projinf.patientflow.ingestion.client.HapiFhirClient;
import com.projinf.patientflow.ingestion.client.HapiFhirClient.HapiStoreResponse;
import com.projinf.patientflow.ingestion.converter.Hl7ToFhirConverter;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Core ingestion pipeline service:
 * 1. Inspects incoming messages from subscribed APIs or HTTP endpoints.
 * 2. Converts raw or wrapped HL7 v2 messages into FHIR Bundles via {@link Hl7ToFhirConverter}.
 * 3. Persists the FHIR contents into HAPI FHIR via {@link HapiFhirClient}.
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
            JsonNode fhirBundle,
            String detail
    ) {
    }

    public record PipelineMetrics(
            long totalReceived,
            long convertedFromHl7,
            long storedInHapi,
            long failed,
            Instant lastIngestedAt
    ) {
    }

    private final Hl7ToFhirConverter converter;
    private final HapiFhirClient hapiClient;
    private final JsonMapper json;

    private final AtomicLong totalReceived = new AtomicLong();
    private final AtomicLong convertedFromHl7 = new AtomicLong();
    private final AtomicLong storedInHapi = new AtomicLong();
    private final AtomicLong failed = new AtomicLong();
    private final AtomicReference<Instant> lastIngestedAt = new AtomicReference<>();

    public IngestionPipelineService(
            Hl7ToFhirConverter converter,
            HapiFhirClient hapiClient,
            JsonMapper json
    ) {
        this.converter = converter;
        this.hapiClient = hapiClient;
        this.json = json;
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
                ObjectNode bundle = converter.convert(trimmed);
                convertedFromHl7.incrementAndGet();
                return storeBundle(bundle, source, true);
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

        // Case 1: JSON wrapper containing an "hl7" field (e.g. SSE event from data-generator /api/hl7/live)
        JsonNode hl7Field = node.path("hl7");
        if (hl7Field.isString() && !hl7Field.asString().isBlank()) {
            ObjectNode bundle = converter.convert(hl7Field.asString());
            convertedFromHl7.incrementAndGet();
            return storeBundle(bundle, source, true);
        }

        // Case 2: Already a FHIR Bundle
        String resourceType = node.path("resourceType").asString("");
        if ("Bundle".equals(resourceType)) {
            return storeBundle(node, source, false);
        }

        // Case 3: Single FHIR Resource (wrap into a collection Bundle)
        if (!resourceType.isEmpty()) {
            ObjectNode wrapper = json.createObjectNode();
            wrapper.put("resourceType", "Bundle");
            wrapper.put("type", "collection");
            wrapper.putArray("entry").addObject().set("resource", node);
            return storeBundle(wrapper, source, false);
        }

        throw new IllegalArgumentException("Unsupported JSON payload: expected 'hl7' field or FHIR 'resourceType'");
    }

    private IngestionOutcome storeBundle(JsonNode bundle, String source, boolean wasConverted) {
        HapiStoreResponse hapiRes = hapiClient.storeBundle(bundle);
        if (hapiRes.stored()) {
            storedInHapi.incrementAndGet();
            lastIngestedAt.set(Instant.now());
        } else {
            failed.incrementAndGet();
        }
        return new IngestionOutcome(
                source,
                wasConverted,
                hapiRes.stored(),
                hapiRes.statusCode(),
                hapiRes.resourceCount(),
                bundle,
                hapiRes.detail()
        );
    }

    public PipelineMetrics metrics() {
        return new PipelineMetrics(
                totalReceived.get(),
                convertedFromHl7.get(),
                storedInHapi.get(),
                failed.get(),
                lastIngestedAt.get()
        );
    }
}

