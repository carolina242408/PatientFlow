package com.projinf.patientflow.event;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** The audience remains on the server. Clients receive only Message, with no patient details. */
public record DomainChange(Message message, List<OrgScope> scopes, String subject) {
    public record OrgScope(UUID ulsId, UUID unitId, UUID buildingId, UUID floorId,
            UUID serviceId, UUID wingId, UUID wardId) { }
    public record Message(UUID id, String type, Instant occurredAt, String resourceType, UUID resourceId) { }
    public DomainChange { scopes=List.copyOf(scopes); }
}
