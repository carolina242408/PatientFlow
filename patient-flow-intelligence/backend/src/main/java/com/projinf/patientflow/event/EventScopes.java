package com.projinf.patientflow.event;

import com.projinf.patientflow.event.DomainChange.OrgScope;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class EventScopes {
    private final JdbcTemplate jdbc;
    public EventScopes(JdbcTemplate jdbc) { this.jdbc=jdbc; }

    public List<OrgScope> resource(String type, UUID id) {
        String select="SELECT DISTINCT uls_id,unit_id,service_id FROM organization_scope WHERE ";
        return switch(type) {
            case "ENCOUNTER" -> rows(select+"kind='SERVICE' AND id=(SELECT service_id FROM encounters WHERE id=?)",id);
            case "ADMISSION_REQUEST" -> rows(select+"kind='SERVICE' AND id=(SELECT service_id FROM admission_requests WHERE id=?)",id);
            case "PATIENT" -> rows(select+"kind='SERVICE' AND id IN (SELECT service_id FROM encounters WHERE patient_id=?"
                +" UNION SELECT service_id FROM admission_requests WHERE patient_id=?)",id,id);
            case "ULS", "UNIT", "BUILDING", "FLOOR", "WING" -> {
                List<OrgScope> scopes=new ArrayList<>(rows(select+"kind=? AND id=?",type,id));
                String column=type.toLowerCase(Locale.ROOT)+"_id";
                scopes.addAll(rows(select+column+"=? AND kind IN ('WARD','SERVICE')",id));
                yield scopes.stream().distinct().toList();
            }
            case "SERVICE", "WARD", "ROOM", "BED" -> rows(select+"kind=? AND id=?",type,id);
            default -> throw new IllegalArgumentException("Tipo de evento desconhecido");
        };
    }

    private List<OrgScope> rows(String sql, Object... args) {
        return jdbc.query(sql,(r,n)->new OrgScope(r.getObject("uls_id",UUID.class),r.getObject("unit_id",UUID.class),
            r.getObject("service_id",UUID.class)),args);
    }
}
