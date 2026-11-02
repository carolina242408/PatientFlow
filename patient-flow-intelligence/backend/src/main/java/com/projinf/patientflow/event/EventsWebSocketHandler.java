package com.projinf.patientflow.event;

import com.projinf.patientflow.security.AccessIdentity;
import com.projinf.patientflow.security.AccessPolicy;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import tools.jackson.databind.json.JsonMapper;

@Component
public class EventsWebSocketHandler extends TextWebSocketHandler {
    private static final Logger log=LoggerFactory.getLogger(EventsWebSocketHandler.class);
    private record Client(WebSocketSession session,AccessIdentity identity) { }
    private final Map<String,Client> clients=new ConcurrentHashMap<>();
    private final EventTickets tickets;
    private final AccessPolicy access;
    private final NamedParameterJdbcTemplate jdbc;
    private final JsonMapper json;
    public EventsWebSocketHandler(EventTickets tickets,AccessPolicy access,NamedParameterJdbcTemplate jdbc,JsonMapper json) {
        this.tickets=tickets; this.access=access; this.jdbc=jdbc; this.json=json;
    }
    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        AccessIdentity identity=(AccessIdentity)session.getAttributes().get("identity");
        if(identity==null || !tickets.active(identity)) { session.close(CloseStatus.POLICY_VIOLATION); return; }
        Client client=new Client(new ConcurrentWebSocketSessionDecorator(session,10000,65536),identity);
        clients.put(session.getId(),client);
        send(client,new DomainChange.Message(UUID.randomUUID(),"RESYNC_REQUIRED",Instant.now(),"SNAPSHOT",null));
    }
    @Override public void afterConnectionClosed(WebSocketSession session,CloseStatus status) { clients.remove(session.getId()); }
    @Override protected void handleTextMessage(WebSocketSession session,TextMessage message) throws Exception {
        // Audiences are always derived from server-side grants, never from client topics.
        session.close(CloseStatus.POLICY_VIOLATION);
    }
    @Override public void handleTransportError(WebSocketSession session,Throwable error) { close(clients.get(session.getId())); }

    @TransactionalEventListener(phase=TransactionPhase.AFTER_COMMIT)
    public void committed(DomainChange event) {
        for(Client client:clients.values()) {
            try {
                if(!tickets.active(client.identity())) { close(client); continue; }
                if(visible(client.identity(),event)) send(client,event.message());
            } catch(Exception exception) {
                // Delivery failure must not turn a committed HTTP mutation into a failed response.
                log.warn("Event delivery failed for websocket {}",client.session().getId());
                close(client);
            }
        }
    }

    private boolean visible(AccessIdentity identity,DomainChange event) {
        if(identity.admin()) return true;
        if(event.subject()!=null) return event.subject().equals(identity.subject());
        for(var scope:event.scopes()) {
            Map<String,Object> args=new HashMap<>(access.bindings(identity));
            // Explicit UUID casts also handle scopes of organizational ancestors with null fields.
            args.put("eventUls",scope.ulsId()); args.put("eventUnit",scope.unitId()); args.put("eventService",scope.serviceId());
            if(jdbc.queryForObject("SELECT "+access.sql("CAST(:eventUls AS uuid)","CAST(:eventUnit AS uuid)",
                "CAST(:eventService AS uuid)"),args,Boolean.class)) return true;
        }
        return false;
    }

    private void send(Client client,DomainChange.Message message) throws IOException {
        client.session().sendMessage(new TextMessage(json.writeValueAsString(message)));
    }
    @Scheduled(fixedDelay=1000)
    public void expire() {
        for(Client client:clients.values()) {
            try { if(!tickets.active(client.identity())) close(client); }
            catch(Exception unavailable) { close(client); }
        }
    }
    private void close(Client client) {
        if(client==null) return;
        clients.remove(client.session().getId());
        try { client.session().close(CloseStatus.POLICY_VIOLATION); } catch(IOException ignored) { }
    }
    @PreDestroy public void shutdown() { for(Client client:clients.values()) close(client); }
}
