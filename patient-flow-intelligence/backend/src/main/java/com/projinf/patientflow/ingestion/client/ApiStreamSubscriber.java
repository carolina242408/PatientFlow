package com.projinf.patientflow.ingestion.client;

import com.projinf.patientflow.ingestion.config.IngestionProperties;
import com.projinf.patientflow.ingestion.service.IngestionPipelineService;
import jakarta.annotation.PreDestroy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.Stream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Subscribes to external API streams (such as the Data Generator SSE `/api/hl7/live` endpoint
 * or any additional URLs configured in `INGESTION_SOURCES` in `.env`) and forwards incoming
 * HL7/FHIR events into {@link IngestionPipelineService}.
 */
@Component
public class ApiStreamSubscriber {

    private static final Logger log = LoggerFactory.getLogger(ApiStreamSubscriber.class);

    public record SubscriptionStatus(
            String url,
            boolean active,
            String state,
            Instant lastEventAt,
            String lastError
    ) {
    }

    private static final class SourceWorker {
        final URI uri;
        final AtomicBoolean running = new AtomicBoolean(true);
        volatile String state = "CONNECTING";
        volatile Instant lastEventAt;
        volatile String lastError;
        volatile Future<?> task;

        SourceWorker(URI uri) {
            this.uri = uri;
        }
    }

    private final IngestionProperties properties;
    private final IngestionPipelineService pipeline;
    private final HttpClient httpClient;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    private final Map<String, SourceWorker> workers = new ConcurrentHashMap<>();

    public ApiStreamSubscriber(IngestionProperties properties, IngestionPipelineService pipeline) {
        this.properties = properties;
        this.pipeline = pipeline;
        this.httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(properties.connectTimeout())
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    @EventListener(ApplicationReadyEvent.class)
    public void startConfiguredSubscriptions() {
        if (!properties.enabled()) {
            log.info("API Ingestion subscriber is disabled (patientflow.ingestion.enabled=false)");
            return;
        }
        for (URI uri : properties.resolvedSourceUris()) {
            subscribe(uri);
        }
    }

    public SubscriptionStatus subscribe(URI uri) {
        String key = uri.toString();
        SourceWorker worker = workers.computeIfAbsent(key, k -> {
            SourceWorker w = new SourceWorker(uri);
            w.task = executor.submit(() -> consumeLoop(w));
            log.info("Subscribed ingestion worker to API source: {}", uri);
            return w;
        });
        return toStatus(worker);
    }

    public boolean unsubscribe(String url) {
        SourceWorker worker = workers.remove(url);
        if (worker == null) {
            return false;
        }
        worker.running.set(false);
        if (worker.task != null) {
            worker.task.cancel(true);
        }
        log.info("Unsubscribed ingestion worker from API source: {}", url);
        return true;
    }

    public List<SubscriptionStatus> activeSubscriptions() {
        List<SubscriptionStatus> list = new ArrayList<>();
        for (SourceWorker w : workers.values()) {
            list.add(toStatus(w));
        }
        return list;
    }

    private void consumeLoop(SourceWorker worker) {
        long retryDelayMs = Math.max(1000L, properties.reconnectDelay().toMillis());
        while (worker.running.get() && !Thread.currentThread().isInterrupted()) {
            try {
                worker.state = "CONNECTING";
                HttpRequest request = HttpRequest.newBuilder(worker.uri)
                        .header("Accept", "text/event-stream, application/fhir+json, application/json, text/plain")
                        .GET()
                        .build();

                HttpResponse<Stream<String>> response = httpClient.send(
                        request,
                        HttpResponse.BodyHandlers.ofLines()
                );

                if (response.statusCode() < 200 || response.statusCode() >= 300) {
                    worker.state = "HTTP_" + response.statusCode();
                    worker.lastError = "Unexpected HTTP status " + response.statusCode();
                    Thread.sleep(retryDelayMs);
                    continue;
                }

                worker.state = "STREAMING";
                worker.lastError = null;
                String contentType = response.headers().firstValue("content-type").orElse("");

                try (Stream<String> lines = response.body()) {
                    if (contentType.contains("text/event-stream")) {
                        consumeSseLines(worker, lines);
                    } else {
                        StringBuilder body = new StringBuilder();
                        lines.forEach(line -> body.append(line).append("\n"));
                        String payload = body.toString().trim();
                        if (!payload.isEmpty()) {
                            pipeline.process(payload, worker.uri.toString());
                            worker.lastEventAt = Instant.now();
                        }
                    }
                }
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception ex) {
                worker.state = "RECONNECTING";
                worker.lastError = ex.getMessage();
                log.debug("Stream connection to {} interrupted ({}), retrying in {} ms",
                        worker.uri, ex.getMessage(), retryDelayMs);
            }

            if (worker.running.get() && !Thread.currentThread().isInterrupted()) {
                try {
                    Thread.sleep(retryDelayMs);
                } catch (InterruptedException ex) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
        worker.state = "STOPPED";
    }

    private void consumeSseLines(SourceWorker worker, Stream<String> lines) {
        StringBuilder dataBuffer = new StringBuilder();
        for (String line : (Iterable<String>) lines::iterator) {
            if (!worker.running.get() || Thread.currentThread().isInterrupted()) {
                break;
            }
            if (line.startsWith("data:")) {
                String dataPart = line.substring(5).trim();
                if (!dataBuffer.isEmpty()) {
                    dataBuffer.append("\n");
                }
                dataBuffer.append(dataPart);
            } else if (line.isBlank() && !dataBuffer.isEmpty()) {
                String eventPayload = dataBuffer.toString();
                dataBuffer.setLength(0);
                try {
                    pipeline.process(eventPayload, worker.uri.toString());
                    worker.lastEventAt = Instant.now();
                } catch (Exception ex) {
                    worker.lastError = ex.getMessage();
                }
            }
        }
    }

    private static SubscriptionStatus toStatus(SourceWorker worker) {
        return new SubscriptionStatus(
                worker.uri.toString(),
                worker.running.get(),
                worker.state,
                worker.lastEventAt,
                worker.lastError
        );
    }

    @PreDestroy
    public void shutdown() {
        for (SourceWorker w : workers.values()) {
            w.running.set(false);
            if (w.task != null) {
                w.task.cancel(true);
            }
        }
        executor.shutdownNow();
    }
}

