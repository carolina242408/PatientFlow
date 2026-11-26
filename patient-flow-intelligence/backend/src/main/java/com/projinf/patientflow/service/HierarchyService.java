package com.projinf.patientflow.service;

import com.projinf.patientflow.dto.OperationalDTO.*;
import com.projinf.patientflow.exception.ConflictException;
import com.projinf.patientflow.repository.HierarchyRepository;
import com.projinf.patientflow.repository.HierarchyRepository.Type;
import com.projinf.patientflow.security.AccessIdentity;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.HashMap;
import com.projinf.patientflow.security.AccessPolicy;
import com.projinf.patientflow.security.KeycloakGroupService;
import java.util.UUID;
import org.springframework.security.access.AccessDeniedException;
import com.projinf.patientflow.event.ChangePublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;

@Service
@Transactional
public class HierarchyService {
    private final ChangePublisher changes;
    private final HierarchyRepository repository;
    private final AccessPolicy access;
    private final KeycloakGroupService keycloakGroups;
    private final RedisResponseCache cache;
    public HierarchyService(HierarchyRepository repository, AccessPolicy access, ChangePublisher changes,
            KeycloakGroupService keycloakGroups,RedisResponseCache cache) {
        this.changes=changes; this.repository = repository; this.access = access; this.keycloakGroups = keycloakGroups;
        this.cache=cache; }

    public PageResult<HierarchyNode> list(Type type,UUID parent,int page,int size) {
        AccessIdentity identity=authorizedIdentity();
        String key=cache.hierarchyListKey(type,parent,page,size,identity);
        return cache.getOrLoad(key,new TypeReference<PageResult<HierarchyNode>>() {},
            ()->repository.list(type,parent,page,size));
    }

    public HierarchyNode get(Type type,UUID id) {
        AccessIdentity identity=authorizedIdentity();
        String key=cache.hierarchyItemKey(type,id,identity);
        return cache.getOrLoad(key,HierarchyNode.class,()->repository.get(type,id));
    }

    private AccessIdentity authorizedIdentity() {
        AccessIdentity identity=access.identity();
        if(!access.operational(identity)) throw new AccessDeniedException("Sem papel e âmbito organizacional atribuídos");
        return identity;
    }

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
            repository.get(Type.SERVICE, repository.serviceOfWing(input.parentId()));
        } else if (input.serviceId() != null) throw new IllegalArgumentException("serviceId só se aplica à enfermaria");
        var created=repository.create(type, new HierarchyWrite(name, code, input.parentId(), input.serviceId()));
        ensureKeycloakHierarchyGroup(type, created);
        changes.changed("HIERARCHY_CREATED",type.name(),created.id());
        cache.invalidateHierarchy();
        return created;
    }

    private void ensureKeycloakHierarchyGroup(Type type, HierarchyNode node) {
        if (!type.supportsKeycloakGroup()) return;

        if (type.parentType == null) {
            keycloakGroups.ensureHierarchyGroup(type, node.id(), node.name(), null);
            return;
        }

        var parent = repository.get(type.parentType, node.parentId());
        ensureKeycloakHierarchyGroup(type.parentType, parent);
        keycloakGroups.ensureHierarchyGroup(type, node.id(), node.name(), parent.id());
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
        if(!updated.name().equals(stored.name())) {
            changes.changed("HIERARCHY_UPDATED",type.name(),id);
            cache.invalidateHierarchy();
        }
        return updated;
    }

    public void delete(Type type, UUID id) {
        access.admin();
        var audience=changes.audience(type.name(),id);
        repository.delete(type,id);
        changes.captured("HIERARCHY_DELETED",type.name(),id,audience);
        cache.invalidateHierarchy();
    }

    private String required(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(field + " obrigatório");
        return value.trim();
    }

    public HierarchyImportResult importHierarchy(List<HierarchyImportRow> rows) {
        access.admin();
        Map<String, UUID> resolved = new HashMap<>();
        Map<String, Integer> createdByType = new LinkedHashMap<>();
        int createdCount = 0;
        int reusedCount = 0;
        UUID firstUlsId = null;

        for (int i = 0; i < rows.size(); i++) {
            int rowNum = i + 1;
            HierarchyImportRow row = rows.get(i);
            String[] values = {
                trimOrNull(row.uls()), trimOrNull(row.unit()), trimOrNull(row.building()),
                trimOrNull(row.floor()), trimOrNull(row.service()), trimOrNull(row.wing()),
                trimOrNull(row.ward()), trimOrNull(row.room()), trimOrNull(row.bed())
            };
            Type[] types = {
                Type.ULS, Type.UNIT, Type.BUILDING, Type.FLOOR, Type.SERVICE,
                Type.WING, Type.WARD, Type.ROOM, Type.BED
            };

            // Validate no gaps (a child level cannot be present when its parent level is blank)
            boolean gapFound = false;
            for (int lvl = 0; lvl < types.length; lvl++) {
                if (values[lvl] == null) {
                    gapFound = true;
                } else if (gapFound) {
                    throw new IllegalArgumentException(
                        "Linha " + rowNum + ": nível '" + types[lvl].name().toLowerCase()
                            + "' preenchido sem o nível pai correspondente");
                }
            }

            UUID parentId = null;
            for (int lvl = 0; lvl < types.length; lvl++) {
                String value = values[lvl];
                if (value == null) break;

                Type type = types[lvl];
                String cacheKey = type.name() + "|" + parentId + "|" + value;
                UUID existingId = resolved.get(cacheKey);
                if (existingId != null) {
                    parentId = existingId;
                    if (type == Type.ULS && firstUlsId == null) firstUlsId = existingId;
                    continue;
                }

                var stored = repository.findByParentAndKey(type, parentId, value);
                if (stored.isPresent()) {
                    UUID id = stored.get().id();
                    resolved.put(cacheKey, id);
                    parentId = id;
                    reusedCount++;
                    if (type == Type.ULS && firstUlsId == null) firstUlsId = id;
                } else {
                    String code = switch (type) {
                        case SERVICE -> nonBlankOrGeneratedCode(row.serviceCode(), value);
                        case WARD -> nonBlankOrGeneratedCode(row.wardCode(), value);
                        case ROOM, BED -> value;
                        default -> null;
                    };
                    String name = (type == Type.ROOM || type == Type.BED) ? code : value;
                    HierarchyNode created = repository.create(
                        type, new HierarchyWrite(name, code, parentId, null));
                    ensureKeycloakHierarchyGroup(type, created);
                    resolved.put(cacheKey, created.id());
                    parentId = created.id();
                    createdCount++;
                    createdByType.merge(type.name().toLowerCase(), 1, Integer::sum);
                    if (type == Type.ULS && firstUlsId == null) firstUlsId = created.id();
                }
            }
        }

        if (createdCount > 0 && firstUlsId != null) {
            changes.changed("HIERARCHY_IMPORTED", Type.ULS.name(), firstUlsId);
            cache.invalidateHierarchy();
        }
        return new HierarchyImportResult(createdCount, reusedCount, createdByType);
    }

    private String trimOrNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private String nonBlankOrGeneratedCode(String explicitCode, String fallbackName) {
        String trimmed = trimOrNull(explicitCode);
        if (trimmed != null) return trimmed;
        return fallbackName.trim().toUpperCase().replaceAll("\\s+", "_");
    }
}
