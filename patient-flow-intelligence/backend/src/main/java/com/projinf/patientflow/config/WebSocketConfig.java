package com.projinf.patientflow.config;

import com.projinf.patientflow.event.EventTickets;
import com.projinf.patientflow.event.EventsWebSocketHandler;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.config.annotation.*;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.util.UriComponentsBuilder;

@Configuration
@EnableWebSocket
@EnableScheduling
public class WebSocketConfig implements WebSocketConfigurer {
    private final EventsWebSocketHandler handler;
    private final EventTickets tickets;
    private final List<String> origins;
    public WebSocketConfig(EventsWebSocketHandler handler,EventTickets tickets,
            @Value("${patientflow.events.allowed-origins:http://localhost:5173,http://127.0.0.1:5173}") List<String> origins) {
        if(origins.isEmpty() || origins.stream().anyMatch(o->o.contains("*")))
            throw new IllegalArgumentException("Explicit websocket origins are required");
        this.handler=handler; this.tickets=tickets; this.origins=origins;
    }
    @Override public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler,"/ws/events").setAllowedOrigins(origins.toArray(String[]::new))
            .addInterceptors(new HandshakeInterceptor() {
                @Override public boolean beforeHandshake(ServerHttpRequest request,ServerHttpResponse response,
                        WebSocketHandler wsHandler,Map<String,Object> attributes) {
                    var values=UriComponentsBuilder.fromUri(request.getURI()).build().getQueryParams().get("ticket");
                    var identity=values!=null && values.size()==1 ? tickets.redeem(values.getFirst()) : null;
                    if(identity==null) { response.setStatusCode(HttpStatus.UNAUTHORIZED); return false; }
                    attributes.put("identity",identity); return true;
                }
                @Override public void afterHandshake(ServerHttpRequest request,ServerHttpResponse response,
                        WebSocketHandler wsHandler,Exception exception) { }
            });
    }
}
