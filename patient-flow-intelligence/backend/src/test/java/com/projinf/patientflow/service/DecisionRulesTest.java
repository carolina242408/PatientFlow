package com.projinf.patientflow.service;

import static org.assertj.core.api.Assertions.assertThat;
import com.projinf.patientflow.dto.AnalyticsDTO.*;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.core.io.ClassPathResource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class DecisionRulesTest {
    private final JsonMapper json=JsonMapper.builder().build();
    private JsonNode contract() throws Exception {
        return json.readTree(new ClassPathResource("decision-contract/rules-v1.json").getContentAsString(StandardCharsets.UTF_8));
    }
    @Test
    void javaAndPythonShareRankingAndForecastExamples() throws Exception {
        var fixture=contract();
        var rank=json.readValue(fixture.path("rankInput").toString(),RankInput.class);
        var forecast=json.readValue(fixture.path("forecastInput").toString(),ForecastBatch.class);
        assertThat(DecisionRules.rank(rank)).isEqualTo(json.readValue(fixture.path("rankOutput").toString(),RankOutput.class));
        assertThat(DecisionRules.forecast(forecast)).isEqualTo(json.readValue(fixture.path("forecastOutput").toString(),ForecastOutput.class));
    }
    @Test
    void httpClientSendsOnlyContractDataAndAcceptsMatchingResults() throws Exception {
        var fixture=contract();
        var received=new AtomicReference<JsonNode>();
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/v1/bed-ranking",exchange->{
            received.set(json.readTree(exchange.getRequestBody().readAllBytes()));
            byte[] output=fixture.path("rankOutput").toString().getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200,output.length); exchange.getResponseBody().write(output); exchange.close();
        });
        server.createContext("/v1/occupancy-forecast",exchange->{
            byte[] output=fixture.path("forecastOutput").toString().getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200,output.length); exchange.getResponseBody().write(output); exchange.close();
        });
        server.start();
        try {
            var client=client(server.getAddress().getPort(),Duration.ofSeconds(2));
            var ranked=client.rank(json.readValue(fixture.path("rankInput").toString(),RankInput.class));
            assertThat(ranked.engine().source()).isEqualTo("ALGORITHMS_SERVICE");
            assertThat(ranked.engine().degraded()).isFalse();
            assertThat(received.get()).isEqualTo(fixture.path("rankInput"));
            assertThat(client.forecast(json.readValue(fixture.path("forecastInput").toString(),ForecastBatch.class))
                .engine().source()).isEqualTo("ALGORITHMS_SERVICE");
        } finally { server.stop(0); }
    }
    @ParameterizedTest
    @ValueSource(strings={"malformed","fabricated","oversized","unavailable"})
    void invalidOrUnavailableResponsesUseTheLocalBaseline(String failure) throws Exception {
        var fixture=contract();
        var input=json.readValue(fixture.path("rankInput").toString(),RankInput.class);
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/v1/bed-ranking",exchange->{
            byte[] body=switch(failure) {
                case "malformed" -> "{".getBytes(StandardCharsets.UTF_8);
                case "fabricated" -> fixture.path("rankOutput").toString().replace("120","999").getBytes(StandardCharsets.UTF_8);
                case "oversized" -> "x".repeat(262145).getBytes(StandardCharsets.UTF_8);
                default -> "{}".getBytes(StandardCharsets.UTF_8);
            };
            exchange.sendResponseHeaders(failure.equals("unavailable")?503:200,body.length);
            try { exchange.getResponseBody().write(body); } catch(java.io.IOException cancelled) { }
            finally { exchange.close(); }
        });
        server.start();
        try {
            var result=client(server.getAddress().getPort(),Duration.ofSeconds(2)).rank(input);
            assertThat(result.engine().source()).isEqualTo("BACKEND_BASELINE");
            assertThat(result.engine().degraded()).isTrue();
            assertThat(result.value()).isEqualTo(DecisionRules.rank(input));
        } finally { server.stop(0); }
    }
    @Test
    void requestTimeoutDoesNotBlockDecisionSupport() throws Exception {
        var fixture=contract();
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/v1/bed-ranking",exchange->{
            try { Thread.sleep(400); } catch(InterruptedException stopped) { Thread.currentThread().interrupt(); }
            exchange.close();
        });
        server.start();
        try {
            long started=System.nanoTime();
            var result=client(server.getAddress().getPort(),Duration.ofMillis(75))
                .rank(json.readValue(fixture.path("rankInput").toString(),RankInput.class));
            assertThat(result.engine().degraded()).isTrue();
            assertThat(Duration.ofNanos(System.nanoTime()-started)).isLessThan(Duration.ofSeconds(2));
        } finally { server.stop(0); }
    }
    private AlgorithmsClient client(int port,Duration timeout) {
        return new AlgorithmsClient(json,URI.create("http://127.0.0.1:"+port),true,Duration.ofMillis(100),timeout);
    }
}
