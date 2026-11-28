package com.projinf.patientflow.service;

import com.projinf.patientflow.event.ChangePublisher;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Component
public class DischargePredictionQueue {
    public static final String REQUESTS = "discharge.prediction.requests";
    public static final String RESULTS = "discharge.prediction.results";
    private static final Logger log = LoggerFactory.getLogger(DischargePredictionQueue.class);

    private final RabbitTemplate rabbit;
    private final JsonMapper json;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ChangePublisher changes;
    private final boolean enabled;

    public DischargePredictionQueue(RabbitTemplate rabbit, JsonMapper json, JdbcTemplate jdbc,
            TransactionTemplate transactions, ChangePublisher changes,
            @Value("${patientflow.algorithms.enabled:true}") boolean enabled) {
        this.rabbit = rabbit; this.json = json; this.jdbc = jdbc;
        this.transactions = transactions; this.changes = changes; this.enabled = enabled;
    }

    @Bean
    static Queue dischargePredictionRequests() { return new Queue(REQUESTS, true); }

    @Bean
    static Queue dischargePredictionResults() { return new Queue(RESULTS, true); }

    /** Publica o pedido de previsão. A admissão nunca depende disto: uma falha só fica no log. */
    public void request(UUID encounterId, AlgorithmsClient.DischargeInput input) {
        if (!enabled) return;
        try {
            // Exchange por omissão: a routing key é o nome da fila. As mensagens são persistentes por omissão.
            rabbit.convertAndSend(REQUESTS, json.writeValueAsString(
                    Map.of("encounterId", encounterId.toString(), "input", input)));
        } catch (RuntimeException unavailable) {
            // se o próprio broker estiver em baixo o pedido perde-se
            log.warn("Discharge prediction request for encounter {} not queued: {}", encounterId, unavailable.getMessage());
        }
    }

    /** Grava a previsão recebida. Não sobrescreve um plano já definido nem um episódio cuja admissão mudou. */
    @RabbitListener(queues = RESULTS)
    public void onResult(Message message) {
        UUID encounterId; OffsetDateTime admitted; OffsetDateTime predicted;
        try {
            JsonNode result = json.readTree(new String(message.getBody(), StandardCharsets.UTF_8));
            encounterId = UUID.fromString(result.path("encounterId").asString(""));
            if (!result.path("modelVersion").asString("").startsWith("kumo-small-")) {
                throw new IllegalArgumentException("unexpected model version");
            }
            admitted = OffsetDateTime.parse(result.path("admittedAt").asString(""));
            Instant at = OffsetDateTime.parse(result.path("expectedDischargeAt").asString("")).toInstant();
            if (at.isBefore(admitted.toInstant())) throw new IllegalArgumentException("prediction precedes admission");
            predicted = at.atOffset(ZoneOffset.UTC);
        } catch (RuntimeException invalid) {
            // Um resultado malformado nunca passará a ser válido: descarta-se em vez de voltar à fila.
            log.warn("Discarding invalid discharge prediction result: {}", invalid.getMessage());
            return;
        }
        // Uma falha da base de dados propaga-se e a mensagem volta à fila.
        transactions.executeWithoutResult(tx -> {
            int updated = jdbc.update(
                    "UPDATE encounters SET expected_discharge_at = ?, version = version + 1 "
                            + "WHERE id = ? AND expected_discharge_at IS NULL AND status = 'IN_PROGRESS' "
                            + "AND start_period = ? AND start_period <= ?",
                    predicted, encounterId, admitted, predicted);
            if (updated == 1) {
                changes.changed("DISCHARGE_PLAN_CHANGED", "ENCOUNTER", encounterId);
            }
        });
    }
}
