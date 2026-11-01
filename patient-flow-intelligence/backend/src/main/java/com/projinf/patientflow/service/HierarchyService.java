package com.projinf.patientflow.service;

import com.projinf.patientflow.dto.OperationalDTO.*;
import com.projinf.patientflow.exception.ConflictException;
import com.projinf.patientflow.repository.HierarchyRepository;
import com.projinf.patientflow.repository.HierarchyRepository.Type;
import java.util.Objects;
import com.projinf.patientflow.security.AccessPolicy;
import com.projinf.patientflow.security.KeycloakGroupService;
import java.util.UUID;
import com.projinf.patientflow.event.ChangePublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional
public class HierarchyService {
    private final ChangePublisher changes;
    private final HierarchyRepository repository;
    private final AccessPolicy access;
    private final KeycloakGroupService keycloakGroups;
    public HierarchyService(HierarchyRepository repository, AccessPolicy access, ChangePublisher changes,
            KeycloakGroupService keycloakGroups) {
        this.changes=changes; this.repository = repository; this.access = access; this.keycloakGroups = keycloakGroups; }

    public HierarchyNode create(Type type, HierarchyWrite input) {
        access.admin();
        if (type.parentType == null) {
            if (input.parentId() != null) throw new IllegalArgumentException("ULS não tem pai");
        } else {
            if (input.parentId() == null) throw new IllegalArgumentException("parentId obrigatório");
            repository.get(type.parentType, input.parentId());
        }
        String code = type.hasCode ? required(input.code(), "code") : null;
        if (!type.hasCode && input.code() != null) throw new IllegalArgumentException("Este nível não usa code");
        String name = type == Type.ROOM || type == Type.BED ? code : required(input.name(), "name");
        if (type == Type.WARD) {
            if (input.serviceId() == null) throw new IllegalArgumentException("serviceId obrigatório na enfermaria");
            var service = repository.get(Type.SERVICE, input.serviceId());
            if (!service.parentId().equals(repository.unitOfWing(input.parentId()))) {
                throw new ConflictException("Serviço e enfermaria devem pertencer à mesma unidade");
            }
        } else if (input.serviceId() != null) throw new IllegalArgumentException("serviceId só se aplica à enfermaria");
        var created=repository.create(type, new HierarchyWrite(name, code, input.parentId(), input.serviceId()));
        keycloakGroups.ensureHierarchyGroup(type, created.id(), created.name(), created.parentId());
        changes.changed("HIERARCHY_CREATED",type.name(),created.id());
        return created;
    }

    public HierarchyNode update(Type type, UUID id, HierarchyWrite input) {
        access.admin();
        var stored = repository.get(type, id);
        if ((input.parentId() != null && !Objects.equals(input.parentId(), stored.parentId()))
                || (input.code() != null && !Objects.equals(input.code().trim(), stored.code()))
                || (input.serviceId() != null && !Objects.equals(input.serviceId(), stored.serviceId()))) {
            throw new ConflictException("Pai, código e serviço são identidades imutáveis; crie um novo elemento");
        }
        if (type == Type.BED || type == Type.ROOM) {
            if (input.name() != null && !input.name().equals(stored.code())) {
                throw new IllegalArgumentException("Quartos e camas são identificados pelo código");
            }
            return stored;
        }
        var updated=repository.rename(type, id, required(input.name(), "name"));
        if(!updated.name().equals(stored.name())) changes.changed("HIERARCHY_UPDATED",type.name(),id);
        return updated;
    }

    public void delete(Type type, UUID id) {
        access.admin();
        var audience=changes.audience(type.name(),id);
        repository.delete(type,id);
        changes.captured("HIERARCHY_DELETED",type.name(),id,audience);
    }

    private String required(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(field + " obrigatório");
        return value.trim();
    }
}
