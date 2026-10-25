package com.projinf.patientflow.repository;

import com.projinf.patientflow.dto.OperationalDTO.*;
import com.projinf.patientflow.exception.ResourceNotFoundException;
import java.util.*;
import com.projinf.patientflow.security.AccessPolicy;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

/** Table and column names originate exclusively in this closed enum, never in request values. */
@Repository
public class HierarchyRepository {
    public enum Type {
        ULS("uls", "name", null, null, false),
        UNIT("healthcare_units", "name", "uls_id", ULS, false),
        BUILDING("buildings", "name", "unit_id", UNIT, false),
        FLOOR("floors", "level_name", "building_id", BUILDING, false),
        WING("wings", "name", "floor_id", FLOOR, false),
        SERVICE("clinical_services", "name", "unit_id", UNIT, true),
        WARD("wards", "name", "wing_id", WING, true),
        ROOM("rooms", null, "ward_id", WARD, true),
        BED("beds", null, "room_id", ROOM, true);

        final String table, nameColumn, parentColumn;
        public final Type parentType;
        public final boolean hasCode;
        Type(String table, String nameColumn, String parentColumn, Type parentType, boolean hasCode) {
            this.table = table; this.nameColumn = nameColumn; this.parentColumn = parentColumn;
            this.parentType = parentType; this.hasCode = hasCode;
        }
        public static Type parse(String value) { return valueOf(value.toUpperCase(Locale.ROOT)); }
    }

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate named;
    private final AccessPolicy access;
    public HierarchyRepository(JdbcTemplate jdbc, NamedParameterJdbcTemplate named, AccessPolicy access) {
        this.jdbc = jdbc; this.named = named; this.access = access;
    }

    public static void page(int page, int size) {
        if (page < 0 || size < 1 || size > 100 || (long) page * size > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("Paginação: page >= 0 e size entre 1 e 100");
        }
    }

    private String columns(Type type) {
        return "id, " + (type.parentColumn == null ? "NULL::uuid" : type.parentColumn) + " AS parent_id, "
            + (type.nameColumn == null ? "code" : type.nameColumn) + " AS name, "
            + (type.hasCode ? "code" : "NULL::varchar") + " AS code, "
            + (type == Type.WARD ? "service_id" : "NULL::uuid") + " AS service_id";
    }

    private RowMapper<HierarchyNode> mapper(Type type) {
        return (r, n) -> new HierarchyNode(r.getObject("id", UUID.class), type.name(),
            r.getObject("parent_id", UUID.class), r.getString("name"), r.getString("code"),
            r.getObject("service_id", UUID.class));
    }

    public HierarchyNode get(Type type, UUID id) {
        var params = access.parameters(); params.put("id", id);
        return named.query("SELECT " + columns(type) + " FROM " + type.table + " n WHERE n.id=:id AND "
            + access.hierarchySql(type, "n.id"), params, mapper(type))
            .stream().findFirst().orElseThrow(() -> new ResourceNotFoundException("Elemento da hierarquia não encontrado"));
    }

    public PageResult<HierarchyNode> list(Type type, UUID parent, int page, int size) {
        page(page, size);
        if (parent != null && type.parentColumn == null) throw new IllegalArgumentException("ULS não tem pai");
        String where = " WHERE " + access.hierarchySql(type, "n.id")
            + (parent == null ? "" : " AND " + type.parentColumn + "=:parent");
        var args=access.parameters();
        if(parent!=null) args.put("parent",parent);
        long total=named.queryForObject("SELECT count(*) FROM "+type.table+" n"+where,args,Long.class);
        args.put("limit",size); args.put("offset",(long)page*size);
        var rows=named.query("SELECT "+columns(type)+" FROM "+type.table+" n"+where
            +" ORDER BY "+(type.nameColumn==null ? "code" : type.nameColumn)+", id LIMIT :limit OFFSET :offset",args,mapper(type));
        return new PageResult<>(rows, page, size, total, (total + size - 1) / size);
    }

    public HierarchyNode create(Type type, HierarchyWrite input) {
        UUID id = UUID.randomUUID();
        List<String> columns = new ArrayList<>(List.of("id"));
        List<Object> values = new ArrayList<>(List.of(id));
        if (type.parentColumn != null) { columns.add(type.parentColumn); values.add(input.parentId()); }
        if (type.nameColumn != null) { columns.add(type.nameColumn); values.add(input.name()); }
        if (type.hasCode) { columns.add("code"); values.add(input.code()); }
        if (type == Type.WARD) { columns.add("service_id"); values.add(input.serviceId()); }
        if (type == Type.BED) { columns.add("status"); values.add("AVAILABLE"); }
        jdbc.update("INSERT INTO " + type.table + " (" + String.join(",", columns) + ") VALUES ("
            + String.join(",", Collections.nCopies(values.size(), "?")) + ")", values.toArray());
        return get(type, id);
    }

    public HierarchyNode rename(Type type, UUID id, String name) {
        if (type.nameColumn != null) jdbc.update("UPDATE " + type.table + " SET " + type.nameColumn + " = ? WHERE id = ?", name, id);
        return get(type, id);
    }

    public void delete(Type type, UUID id) {
        if (jdbc.update("DELETE FROM " + type.table + " WHERE id = ?", id) == 0) {
            throw new ResourceNotFoundException("Elemento da hierarquia não encontrado");
        }
    }

    public UUID unitOfWing(UUID wingId) {
        return jdbc.queryForObject("SELECT b.unit_id FROM wings w JOIN floors f ON f.id=w.floor_id "
            + "JOIN buildings b ON b.id=f.building_id WHERE w.id=?", UUID.class, wingId);
    }
}
