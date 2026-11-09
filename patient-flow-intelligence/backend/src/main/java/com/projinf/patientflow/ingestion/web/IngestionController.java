package com.projinf.patientflow.ingestion.web;

import com.projinf.patientflow.ingestion.client.ApiStreamSubscriber;
import com.projinf.patientflow.ingestion.client.ApiStreamSubscriber.SubscriptionStatus;
import com.projinf.patientflow.ingestion.config.IngestionProperties;
import com.projinf.patientflow.ingestion.service.IngestionPipelineService;
import com.projinf.patientflow.ingestion.service.IngestionPipelineService.IngestionOutcome;
import com.projinf.patientflow.ingestion.service.IngestionPipelineService.PipelineMetrics;
import com.projinf.patientflow.ingestion.service.PostgresFhirIngestionService;
import com.projinf.patientflow.ingestion.service.PostgresFhirIngestionService.PostgresIngestionResult;
import com.projinf.patientflow.ingestion.service.PostgresFhirIngestionService.SyncWatermark;
import java.net.URI;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/**
 * REST endpoints for monitoring the HL7/FHIR ingestion pipeline, receiving webhook
 * payloads, managing subscribed API sources, and invoking PostgreSQL JSONB ingestion.
 */
@RestController
@RequestMapping("/api/ingestion")
public class IngestionController {

    public record SourceRequest(String url) {
    }

    public record StatusResponse(
            boolean enabled,
            String hapiFhirUrl,
            PipelineMetrics metrics,
            List<SubscriptionStatus> subscriptions,
            List<SyncWatermark> watermarks
    ) {
    }

    private final IngestionProperties properties;
    private final IngestionPipelineService pipeline;
    private final ApiStreamSubscriber subscriber;
    private final PostgresFhirIngestionService postgresIngestion;

    @Autowired
    public IngestionController(
            IngestionProperties properties,
            IngestionPipelineService pipeline,
            ApiStreamSubscriber subscriber,
            PostgresFhirIngestionService postgresIngestion
    ) {
        this.properties = properties;
        this.pipeline = pipeline;
        this.subscriber = subscriber;
        this.postgresIngestion = postgresIngestion;
    }

    public IngestionController(
            IngestionProperties properties,
            IngestionPipelineService pipeline,
            ApiStreamSubscriber subscriber
    ) {
        this(properties, pipeline, subscriber, null);
    }

    @GetMapping("/status")
    public StatusResponse status() {
        return new StatusResponse(
                properties.enabled(),
                properties.hapiFhirUrl().toString(),
                pipeline.metrics(),
                subscriber.activeSubscriptions(),
                pipeline.watermarks()
        );
    }

    @PostMapping(
            value = "/messages",
            consumes = {
                    MediaType.TEXT_PLAIN_VALUE,
                    MediaType.APPLICATION_JSON_VALUE,
                    "application/fhir+json"
            }
    )
    public IngestionOutcome ingestMessage(@RequestBody String payload) {
        return pipeline.process(payload, "HTTP_PUSH");
    }

    /**
     * Executes the PostgreSQL stored procedure {@code sp_ingest_fhir_payload(jsonb)} directly
     * with a flexible JSONB payload (locations, patients, encounters).
     */
    @PostMapping(value = "/postgres/payload", consumes = MediaType.APPLICATION_JSON_VALUE)
    public PostgresIngestionResult ingestPostgresPayload(@RequestBody JsonNode payload) {
        if (postgresIngestion == null) {
            return PostgresIngestionResult.empty("Postgres ingestion service not configured");
        }
        return postgresIngestion.executeJsonbPayload(payload);
    }

    @PostMapping("/sources")
    public SubscriptionStatus addSource(@RequestBody SourceRequest request) {
        if (request == null || request.url() == null || request.url().isBlank()) {
            throw new IllegalArgumentException("Source URL is required");
        }
        return subscriber.subscribe(URI.create(request.url().trim()));
    }

    @DeleteMapping("/sources")
    public Map<String, Object> removeSource(@RequestParam("url") String url) {
        boolean removed = subscriber.unsubscribe(url);
        return Map.of("url", url, "removed", removed);
    }
}
