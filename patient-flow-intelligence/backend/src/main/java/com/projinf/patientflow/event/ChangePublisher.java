package com.projinf.patientflow.event;

import com.projinf.patientflow.event.DomainChange.*;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Component
@Transactional(propagation=Propagation.MANDATORY)
public class ChangePublisher {
    private final ApplicationEventPublisher publisher;
    private final EventScopes scopes;
    private final EntityManager entities;
    public ChangePublisher(ApplicationEventPublisher publisher, EventScopes scopes, EntityManager entities) {
        this.publisher=publisher; this.scopes=scopes; this.entities=entities;
    }
    public void changed(String type, String resource, UUID id) {
        entities.flush();
        captured(type,resource,id,scopes.resource(resource,id));
    }
    public List<OrgScope> audience(String resource,UUID id) { entities.flush(); return scopes.resource(resource,id); }
    public void captured(String type,String resource,UUID id,List<OrgScope> audience) {
        publisher.publishEvent(new DomainChange(new Message(UUID.randomUUID(),type,Instant.now(),resource,id),audience,null));
    }
    public void accessChanged(String subject,UUID id) {
        publisher.publishEvent(new DomainChange(new Message(UUID.randomUUID(),"ACCESS_CHANGED",Instant.now(),"ACCESS",id),List.of(),subject));
    }
}
