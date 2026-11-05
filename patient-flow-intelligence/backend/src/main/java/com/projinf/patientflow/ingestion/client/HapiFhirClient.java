package com.projinf.patientflow.ingestion.client;

import com.projinf.patientflow.ingestion.config.IngestionProperties;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * HTTP client for persisting FHIR R4 Bundles and resources into the HAPI FHIR server.
 */
@Component
public class HapiFhirClient {

    private static final Logger log = LoggerFactory.getLogger(HapiFhirClient.class);

    public record HapiStoreResponse(
            boolean stored,
            int statusCode,
            int resourceCount,
            String detail
    ) {
    }

    private final JsonMapper json;
    private final IngestionProperties properties;
    private final HttpClient httpClient;
    private final AtomicBoolean connected = new AtomicBoolean(false);
    private final AtomicLong storedBundleCount = new AtomicLong(0);

    public HapiFhirClient(JsonMapper json, IngestionProperties properties) {
        this.json = json;
        this.properties = properties;
        this.httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(properties.connectTimeout())
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    /**
     * Converts a FHIR Bundle into a HAPI FHIR R4 transaction Bundle (using PUT per resource ID)
     * and posts it to the configured HAPI FHIR endpoint.
     */
    public HapiStoreResponse storeBundle(JsonNode bundle) {
        ObjectNode txBundle = toR4TransactionBundle(bundle);
        int count = txBundle.path("entry").size();
        URI targetUri = properties.hapiFhirUrl();

        try {
            String payload = json.writeValueAsString(txBundle);
            HttpRequest request = HttpRequest.newBuilder(targetUri)
                    .timeout(properties.requestTimeout())
                    .header("Content-Type", "application/fhir+json")
                    .header("Accept", "application/fhir+json")
                    .POST(HttpRequest.BodyPublishers.ofString(payload))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            int code = response.statusCode();
            boolean ok = code >= 200 && code < 300;
            if (!ok) {
                connected.set(false);
                log.warn("HAPI FHIR returned HTTP {} for transaction bundle ({} resources): {}",
                        code, count, truncate(response.body(), 400));
            } else {
                long total = storedBundleCount.incrementAndGet();
                if (connected.compareAndSet(false, true)) {
                    log.info("Connected to HAPI FHIR at {} — storing FHIR transaction bundles (latest: {} resources, total stored: {})",
                            targetUri, count, total);
                } else if (total % 100 == 0) {
                    log.info("Stored {} FHIR transaction bundles in HAPI FHIR at {}", total, targetUri);
                }
            }
            return new HapiStoreResponse(ok, code, count, truncate(response.body(), 500));
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            log.warn("Interrupted while storing bundle in HAPI FHIR at {}", targetUri);
            return new HapiStoreResponse(false, 0, count, "Interrupted: " + ex.getMessage());
        } catch (Exception ex) {
            connected.set(false);
            String reason = ex.getMessage() != null
                    ? ex.getMessage()
                    : ex.getClass().getSimpleName() + " (connection refused or HAPI FHIR still starting up)";
            log.warn("Failed to store bundle in HAPI FHIR at {}: {}", targetUri, reason);
            return new HapiStoreResponse(false, 0, count, reason);
        }
    }

    /**
     * Normalizes a collection/transaction Bundle into a valid FHIR R4 transaction Bundle
     * so HAPI FHIR R4 persists every individual resource (Patient, Encounter, Condition, Location, etc.)
     * without duplicating Patient records when multiple events arrive for the same SNS/NS identifier.
     */
    public ObjectNode toR4TransactionBundle(JsonNode bundle) {
        ObjectNode tx = json.createObjectNode();
        tx.put("resourceType", "Bundle");
        tx.put("type", "transaction");

        ArrayNode txEntries = tx.putArray("entry");
        if (bundle == null || !bundle.path("entry").isArray()) {
            return tx;
        }

        // First pass: map any Patient resource with an SNS/NS identifier to a deterministic UUID
        // so admissions, transfers, and discharges for the same patient always upsert the same Patient/{id}.
        Map<String, String> patientIdRemap = new HashMap<>();
        for (JsonNode entry : bundle.path("entry").values()) {
            JsonNode resNode = entry.path("resource");
            if (resNode.isObject() && "Patient".equals(resNode.path("resourceType").asString(""))) {
                String oldId = resNode.path("id").asString("");
                String canonicalId = resolveDeterministicPatientId(resNode);
                if (canonicalId != null && !oldId.isEmpty() && !oldId.equals(canonicalId)) {
                    patientIdRemap.put("Patient/" + oldId, "Patient/" + canonicalId);
                }
            }
        }

        for (JsonNode entry : bundle.path("entry").values()) {
            JsonNode resNode = entry.path("resource");
            if (!resNode.isObject()) {
                continue;
            }
            ObjectNode resource = normalizeResourceForR4((ObjectNode) resNode.deepCopy(), patientIdRemap);
            String resourceType = resource.path("resourceType").asString("");
            String id = resource.path("id").asString("");
            if (resourceType.isEmpty()) {
                continue;
            }

            ObjectNode txEntry = txEntries.addObject();
            if (!id.isEmpty()) {
                txEntry.put("fullUrl", "http://example.org/fhir/" + resourceType + "/" + id);
            } else {
                String fullUrl = entry.path("fullUrl").asString("");
                if (!fullUrl.isEmpty()) {
                    txEntry.put("fullUrl", fullUrl);
                }
            }
            txEntry.set("resource", resource);

            ObjectNode req = txEntry.putObject("request");
            if (!id.isEmpty()) {
                req.put("method", "PUT");
                req.put("url", resourceType + "/" + id);
            } else {
                req.put("method", "POST");
                req.put("url", resourceType);
            }
        }
        return tx;
    }

    private ObjectNode normalizeResourceForR4(ObjectNode resource, Map<String, String> patientIdRemap) {
        String resourceType = resource.path("resourceType").asString("");
        if ("Patient".equals(resourceType)) {
            String canonicalId = resolveDeterministicPatientId(resource);
            if (canonicalId != null) {
                resource.put("id", canonicalId);
            }
        } else if ("Encounter".equals(resourceType)) {
            // In FHIR R5 `class` is an array of CodeableConcept; in FHIR R4 `class` is a single Coding object.
            JsonNode classNode = resource.path("class");
            if (classNode.isArray() && !classNode.isEmpty()) {
                JsonNode firstConcept = classNode.path(0);
                JsonNode codingArr = firstConcept.path("coding");
                if (codingArr.isArray() && !codingArr.isEmpty()) {
                    resource.set("class", codingArr.path(0).deepCopy());
                }
            }
            // In FHIR R5 `actualPeriod` is used; in FHIR R4 `period` is used.
            if (resource.has("actualPeriod") && !resource.has("period")) {
                resource.set("period", resource.path("actualPeriod").deepCopy());
            }
            resource.remove("actualPeriod");
        }

        // Remap subject/beneficiary references if the Patient ID was canonicalized
        if (!patientIdRemap.isEmpty()) {
            remapPatientReference(resource, "subject", patientIdRemap);
            remapPatientReference(resource, "patient", patientIdRemap);
            remapPatientReference(resource, "beneficiary", patientIdRemap);
        }
        return resource;
    }

    private static void remapPatientReference(ObjectNode resource, String field, Map<String, String> remap) {
        JsonNode refObj = resource.path(field);
        if (refObj.isObject()) {
            String ref = refObj.path("reference").asString("");
            String mapped = remap.get(ref);
            if (mapped != null) {
                ((ObjectNode) refObj).put("reference", mapped);
            }
        }
    }

    /**
     * Computes a deterministic UUID v3 (`Patient:<identifier>`) from the patient's SNS (`SB`)
     * or hospital process/NS (`MR`) identifier so the same patient always maps to the same FHIR ID.
     */
    public static String resolveDeterministicPatientId(JsonNode patientResource) {
        JsonNode identifiers = patientResource.path("identifier");
        if (!identifiers.isArray() || identifiers.isEmpty()) {
            return null;
        }
        String snsVal = null;
        String nsVal = null;
        String firstVal = null;

        for (JsonNode idNode : identifiers.values()) {
            String value = idNode.path("value").asString("").trim();
            if (value.isEmpty()) {
                continue;
            }
            if (firstVal == null) {
                firstVal = value;
            }
            String system = idNode.path("system").asString("").toUpperCase();
            String typeText = idNode.path("type").path("text").asString("").toUpperCase();
            String typeCode = idNode.path("type").path("coding").path(0).path("code").asString("").toUpperCase();

            if ("SNS".equals(typeText) || "SB".equals(typeCode) || system.contains("HAS") || system.contains("SNS")) {
                snsVal = value;
            } else if ("NS".equals(typeText) || "MR".equals(typeCode) || system.contains("HOS")) {
                nsVal = value;
            }
        }

        String primaryKey = snsVal != null ? snsVal : (nsVal != null ? nsVal : firstVal);
        if (primaryKey == null || primaryKey.isEmpty()) {
            return null;
        }
        return UUID.nameUUIDFromBytes(("Patient:" + primaryKey).getBytes(StandardCharsets.UTF_8)).toString();
    }

    private static String truncate(String text, int maxLen) {
        if (text == null) return "";
        return text.length() <= maxLen ? text : text.substring(0, maxLen) + "...";
    }
}
