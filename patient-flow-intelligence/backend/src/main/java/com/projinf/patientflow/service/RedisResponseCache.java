package com.projinf.patientflow.service;

import com.projinf.patientflow.dto.OperationalDTO.Scope;
import com.projinf.patientflow.repository.HierarchyRepository.Type;
import com.projinf.patientflow.security.AccessIdentity;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.HexFormat;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

@Component
public class RedisResponseCache {
    private static final String HIERARCHY_VERSION_KEY="patientflow:hierarchy:version";
    private final StringRedisTemplate redis;
    private final JsonMapper json;
    private final Duration ttl;

    public RedisResponseCache(StringRedisTemplate redis,JsonMapper json,
            @Value("${patientflow.analytics.cache-ttl:5s}") Duration ttl) {
        if(ttl.isNegative() || ttl.isZero()) throw new IllegalArgumentException("TTL da cache deve ser positivo");
        this.redis=redis;
        this.json=json;
        this.ttl=ttl;
    }

    public static String occupancyKey(Scope scope,double criticalOccupancyPercent) {
        return "patientflow:analytics:occupancy:v1:"+scope.ulsId()+":"+scope.unitId()+":"+scope.buildingId()
            +":"+scope.floorId()+":"+scope.serviceId()+":"+scope.wingId()+":"+scope.wardId()+":"
            +scope.roomId()+":"+criticalOccupancyPercent;
    }

    public String hierarchyListKey(Type type,UUID parent,int page,int size,AccessIdentity identity) {
        return hierarchyPrefix(identity)+":list:"+type+":"+parent+":"+page+":"+size;
    }

    public String hierarchyItemKey(Type type,UUID id,AccessIdentity identity) {
        return hierarchyPrefix(identity)+":item:"+type+":"+id;
    }

    public void invalidateHierarchy() {
        try {
            redis.opsForValue().increment(HIERARCHY_VERSION_KEY);
        } catch(RuntimeException unavailable) {
            // The short TTL still bounds staleness when Redis is unavailable.
        }
    }

    private String hierarchyPrefix(AccessIdentity identity) {
        String identityData=identity.subject()+":"+identity.roles().stream().sorted().toList()+":"+
            identity.scopeType()+":"+identity.scopeIds().stream().map(UUID::toString).sorted().toList();
        String identityKey=sha256(identityData);
        try {
            String version=redis.opsForValue().get(HIERARCHY_VERSION_KEY);
            return "patientflow:hierarchy:v"+(version==null ? "0" : version)+":"+identityKey;
        } catch(RuntimeException unavailable) {
            return "patientflow:hierarchy:uncached:"+UUID.randomUUID()+":"+identityKey;
        }
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch(NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    public <T> T getOrLoad(String key,Class<T> type,Supplier<T> loader) {
        try {
            String cached=redis.opsForValue().get(key);
            if(cached!=null) return json.readValue(cached,type);
        } catch(RuntimeException unavailableOrInvalid) {
            // Redis is an optimization; a miss or decode failure falls through to PostgreSQL.
        }
        T value=loader.get();
        write(key,value);
        return value;
    }

    public <T> T getOrLoad(String key,TypeReference<T> type,Supplier<T> loader) {
        try {
            String cached=redis.opsForValue().get(key);
            if(cached!=null) return json.readValue(cached,type);
        } catch(RuntimeException unavailableOrInvalid) {
            // Redis is an optimization; a miss or decode failure falls through to PostgreSQL.
        }
        T value=loader.get();
        write(key,value);
        return value;
    }

    private void write(String key,Object value) {
        try {
            redis.opsForValue().set(key,json.writeValueAsString(value),ttl);
        } catch(RuntimeException unavailable) {
            // Keep serving the database result when Redis is unavailable.
        }
    }
}