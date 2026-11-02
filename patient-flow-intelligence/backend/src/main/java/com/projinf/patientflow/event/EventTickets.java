package com.projinf.patientflow.event;

import com.projinf.patientflow.security.AccessIdentity;
import com.projinf.patientflow.security.AccessPolicy;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Component;

@Component
public class EventTickets {
    public record TicketResponse(String ticket,Instant expiresAt,String path) { }
    private record Ticket(AccessIdentity identity,Instant expiresAt) { }
    private final ConcurrentHashMap<String,Ticket> tickets=new ConcurrentHashMap<>();
    private final AccessPolicy access;
    private final Duration ttl;
    private final SecureRandom random=new SecureRandom();
    public EventTickets(AccessPolicy access,@Value("${patientflow.events.ticket-ttl:30s}") Duration ttl) {
        if(ttl.isNegative() || ttl.isZero() || ttl.compareTo(Duration.ofMinutes(1))>0)
            throw new IllegalArgumentException("Ticket TTL must be between zero and one minute");
        this.access=access; this.ttl=ttl;
    }
    public TicketResponse issue() {
        AccessIdentity identity=access.identity();
        if(!active(identity)) throw new AccessDeniedException("Sem autorização ou token com validade suficiente");
        byte[] bytes=new byte[32]; random.nextBytes(bytes);
        String token=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Instant expiresAt=Instant.now().plus(ttl);
        if(identity.expiresAt().isBefore(expiresAt)) expiresAt=identity.expiresAt();
        prune();
        if(tickets.size()>=10000) throw new AccessDeniedException("Limite de bilhetes temporários atingido");
        tickets.put(token,new Ticket(identity,expiresAt));
        return new TicketResponse(token,expiresAt,"/ws/events");
    }
    public AccessIdentity redeem(String token) {
        Ticket ticket=token==null ? null : tickets.remove(token);
        return ticket!=null && ticket.expiresAt().isAfter(Instant.now()) && active(ticket.identity()) ? ticket.identity() : null;
    }
    public boolean active(AccessIdentity identity) {
        return identity.expiresAt()!=null && identity.expiresAt().isAfter(Instant.now()) && access.operational(identity);
    }
    @Scheduled(fixedDelay=5000)
    public void prune() { Instant now=Instant.now(); tickets.entrySet().removeIf(e->!e.getValue().expiresAt().isAfter(now)); }
}
