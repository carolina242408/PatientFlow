package com.projinf.patientflow.ingestion.config;

import java.net.URI;
import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Configuration properties for the PatientFlow API Ingestion & HAPI FHIR storage module.
 * All fields can be configured via environment variables in `.env` (`INGESTION_ENABLED`,
 * `HAPI_FHIR_URL`, `INGESTION_SOURCES`).
 */
@ConfigurationProperties(prefix = "patientflow.ingestion")
public record IngestionProperties(
        @DefaultValue("true") boolean enabled,
        @DefaultValue("http://localhost:8081/fhir") URI hapiFhirUrl,
        @DefaultValue("5s") Duration connectTimeout,
        @DefaultValue("15s") Duration requestTimeout,
        @DefaultValue("5s") Duration reconnectDelay,
        @DefaultValue("http://localhost:8001/api/hl7/live?delay_ms=500&loop=true") List<String> sources
) {
    public List<URI> resolvedSourceUris() {
        if (sources == null || sources.isEmpty()) {
            return List.of();
        }
        return sources.stream()
                .filter(s -> s != null && !s.isBlank())
                .map(String::trim)
                .map(URI::create)
                .toList();
    }
}

