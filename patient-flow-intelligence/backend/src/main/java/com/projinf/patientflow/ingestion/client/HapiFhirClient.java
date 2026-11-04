package com.projinf.patientflow.ingestion.client;

import com.projinf.patientflow.ingestion.config.IngestionProperties;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
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

    public HapiFhirClient(JsonMapper json, IngestionProperties properties) {
        this.json = json;
        this.properties = properties;
        this.httpClient = HttpClient.newBuilder()
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
                log.warn("HAPI FHIR returned HTTP {} for transaction bundle ({} resources): {}",
                        code, count, truncate(response.body(), 400));
            }
            return new HapiStoreResponse(ok, code, count, truncate(response.body(), 500));
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            log.warn("Interrupted while storing bundle in HAPI FHIR at {}", targetUri);
            return new HapiStoreResponse(false, 0, count, "Interrupted: " + ex.getMessage());
        } catch (Exception ex) {
            log.warn("Failed to store bundle in HAPI FHIR at {}: {}", targetUri, ex.getMessage());
            return new HapiStoreResponse(false, 0, count, ex.getMessage());
        }
    }

    /**
     * Normalizes a collection/transaction Bundle into a valid FHIR R4 transaction Bundle
     * so HAPI FHIR R4 persists every individual resource (Patient, Encounter, Condition, Location, etc.).
     */
    public ObjectNode toR4TransactionBundle(JsonNode bundle) {
        ObjectNode tx = json.createObjectNode();
        tx.put("resourceType", "Bundle");
        tx.put("type", "transaction");

        ArrayNode txEntries = tx.putArray("entry");
        if (bundle != null && bundle.path("entry").isArray()) {
            for (JsonNode entry : bundle.path("entry").values()) {
                JsonNode resNode = entry.path("resource");
                if (!resNode.isObject()) {
                    continue;
                }
                ObjectNode resource = normalizeResourceForR4((ObjectNode) resNode.deepCopy());
                String resourceType = resource.path("resourceType").asString("");
                String id = resource.path("id").asString("");
                if (resourceType.isEmpty()) {
                    continue;
                }

                ObjectNode txEntry = txEntries.addObject();
                String fullUrl = entry.path("fullUrl").asString("");
                if (!fullUrl.isEmpty()) {
                    txEntry.put("fullUrl", fullUrl);
                } else if (!id.isEmpty()) {
                    txEntry.put("fullUrl", resourceType + "/" + id);
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
        }
        return tx;
    }

    private ObjectNode normalizeResourceForR4(ObjectNode resource) {
        String resourceType = resource.path("resourceType").asString("");
        if ("Encounter".equals(resourceType)) {
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
        return resource;
    }

    private static String truncate(String text, int maxLen) {
        if (text == null) return "";
        return text.length() <= maxLen ? text : text.substring(0, maxLen) + "...";
    }
}

