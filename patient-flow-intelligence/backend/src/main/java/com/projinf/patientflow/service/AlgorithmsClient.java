package com.projinf.patientflow.service;

import com.projinf.patientflow.dto.AnalyticsDTO.*;
import java.io.IOException;
import java.net.URI;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.*;
import java.util.concurrent.Flow;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

@Component
public class AlgorithmsClient {
    private final JsonMapper json;
    private final HttpClient client;
    private final URI base;
    private final boolean enabled;
    private final Duration timeout;
    public AlgorithmsClient(JsonMapper json,@Value("${patientflow.algorithms.url:http://localhost:8000}") URI base,
            @Value("${patientflow.algorithms.enabled:true}") boolean enabled,
            @Value("${patientflow.algorithms.connect-timeout:500ms}") Duration connect,
            @Value("${patientflow.algorithms.request-timeout:1s}") Duration timeout) {
        if(!List.of("http","https").contains(base.getScheme()) || base.getHost()==null || base.getUserInfo()!=null
                || base.getQuery()!=null || base.getFragment()!=null || connect.isNegative() || connect.isZero()
                || timeout.isNegative() || timeout.isZero()) throw new IllegalArgumentException("Configuração algorithms inválida");
        this.json=json; this.base=base; this.enabled=enabled; this.timeout=timeout;
        this.client=HttpClient.newBuilder().connectTimeout(connect).followRedirects(HttpClient.Redirect.NEVER).build();
    }
    public Decision<RankOutput> rank(RankInput input) { return call("/v1/bed-ranking",input,DecisionRules.rank(input),RankOutput.class); }
    public Decision<ForecastOutput> forecast(ForecastBatch input) { return call("/v1/occupancy-forecast",input,DecisionRules.forecast(input),ForecastOutput.class); }

    /** Previsão de alta. Vazio se o serviço estiver desligado, falhar ou responder mal: a admissão nunca depende disto. */
    public Optional<Instant> predictDischarge(String gender,String birthDate,String diagnosisCode,Instant admittedAt) {
        if(!enabled) return Optional.empty();
        try {
            var body=new LinkedHashMap<String,Object>();
            if(gender!=null) body.put("gender",gender);
            if(birthDate!=null) body.put("birthDate",birthDate);
            body.put("diagnosisCode",diagnosisCode);
            body.put("admittedAt",admittedAt.toString());
            var request=HttpRequest.newBuilder(base.resolve("/v1/discharge-prediction")).timeout(timeout).header("Content-Type","application/json")
                .header("Accept","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build();
            var response=client.send(request,info->new LimitedBody());
            if(response.statusCode()!=200) return Optional.empty();
            return Optional.of(OffsetDateTime.parse(json.readTree(response.body()).path("expectedDischargeAt").asString()).toInstant());
        } catch(InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return Optional.empty();
        } catch(IOException|RuntimeException unavailable) {
            return Optional.empty();
        }
    }

    private <T> Decision<T> call(String path,Object input,T baseline,Class<T> type) {
        if(!enabled) return fallback(baseline,false,"SERVICE_DISABLED");
        CompletableFuture<HttpResponse<byte[]>> pending=null;
        try {
            var request=HttpRequest.newBuilder(base.resolve(path)).timeout(timeout).header("Content-Type","application/json")
                .header("Accept","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(input))).build();
            pending=client.sendAsync(request,info->new LimitedBody());
            var response=pending.get(timeout.toMillis(),TimeUnit.MILLISECONDS);
            if(response.statusCode()!=200) return fallback(baseline,true,"SERVICE_UNAVAILABLE");
            T output=json.readValue(response.body(),type);
            // The versioned rule contract also rejects fabricated IDs, scores, order, or estimates.
            if(!baseline.equals(output)) return fallback(baseline,true,"INVALID_RESPONSE");
            return new Decision<>(new Engine("ALGORITHMS_SERVICE",DecisionRules.VERSION,false,null),output);
        } catch(InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return fallback(baseline,true,"SERVICE_UNAVAILABLE");
        } catch(TimeoutException|ExecutionException unavailable) {
            return fallback(baseline,true,"SERVICE_UNAVAILABLE");
        } catch(RuntimeException invalid) {
            return fallback(baseline,true,"INVALID_RESPONSE");
        } finally {
            if(pending!=null && !pending.isDone()) pending.cancel(true);
        }
    }
    private <T> Decision<T> fallback(T baseline,boolean degraded,String reason) {
        return new Decision<>(new Engine("BACKEND_BASELINE",DecisionRules.VERSION,degraded,reason),baseline);
    }
    private static class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final HttpResponse.BodySubscriber<byte[]> delegate=HttpResponse.BodySubscribers.ofByteArray();
        private Flow.Subscription subscription;
        private long bytes;
        @Override public CompletionStage<byte[]> getBody() { return delegate.getBody(); }
        @Override public void onSubscribe(Flow.Subscription value) { subscription=value; delegate.onSubscribe(value); }
        @Override public void onNext(List<ByteBuffer> buffers) {
            for(var buffer:buffers) bytes+=buffer.remaining();
            if(bytes>262144) { subscription.cancel(); delegate.onError(new IOException("Response exceeds contract limit")); }
            else delegate.onNext(buffers);
        }
        @Override public void onError(Throwable error) { delegate.onError(error); }
        @Override public void onComplete() { delegate.onComplete(); }
    }
}
