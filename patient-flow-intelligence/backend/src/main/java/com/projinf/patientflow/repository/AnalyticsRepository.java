package com.projinf.patientflow.repository;

import com.projinf.patientflow.config.AnalyticsSettings;
import com.projinf.patientflow.dto.AnalyticsDTO.*;
import com.projinf.patientflow.dto.OperationalDTO.*;
import com.projinf.patientflow.security.AccessPolicy;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class AnalyticsRepository {
    private final NamedParameterJdbcTemplate jdbc;
    private final AccessPolicy access;
    public AnalyticsRepository(NamedParameterJdbcTemplate jdbc,AccessPolicy access) { this.jdbc=jdbc; this.access=access; }

    public static void validateScope(Scope scope) {
        if(scope.wardId()!=null) throw new IllegalArgumentException("A análise agrega ULS, unidade ou serviço; a fila não tem enfermaria atribuída");
    }
    private Map<String,Object> parameters(Scope scope,Instant from,Instant to,Instant now,AnalyticsSettings settings) {
        validateScope(scope);
        var p=access.parameters();
        if(scope.ulsId()!=null) p.put("uls",scope.ulsId());
        if(scope.unitId()!=null) p.put("unit",scope.unitId());
        if(scope.serviceId()!=null) p.put("service",scope.serviceId());
        p.put("from",Timestamp.from(from)); p.put("to",Timestamp.from(to)); p.put("now",Timestamp.from(now));
        p.put("next24",Timestamp.from(now.plusSeconds(86400))); p.put("next48",Timestamp.from(now.plusSeconds(172800)));
        p.put("longSeconds",settings.longStayDays()*86400L); p.put("waitSeconds",settings.waitingWarningHours()*3600d);
        return p;
    }
    private String where(Scope scope) {
        return " WHERE "+access.sql("u.uls_id","u.id","s.id")
            +(scope.ulsId()==null ? "" : " AND u.uls_id=:uls")
            +(scope.unitId()==null ? "" : " AND u.id=:unit")
            +(scope.serviceId()==null ? "" : " AND s.id=:service");
    }
    public Indicators indicators(Scope scope,Instant from,Instant to,Instant now,AnalyticsSettings settings) {
        var p=parameters(scope,from,to,now,settings);
        String filter=where(scope);
        BedIndicators beds=jdbc.queryForObject("""
            SELECT count(*) AS total,count(*) FILTER(WHERE b.status='AVAILABLE') AS available,
            count(*) FILTER(WHERE b.status='OCCUPIED') AS occupied,count(*) FILTER(WHERE b.status='BLOCKED') AS blocked,
            count(*) FILTER(WHERE b.status='CLEANING') AS cleaning
            FROM beds b JOIN rooms r ON r.id=b.room_id JOIN wards w ON w.id=r.ward_id
            JOIN wings wi ON wi.id=w.wing_id JOIN clinical_services s ON s.id=wi.service_id
            JOIN floors f ON f.id=s.floor_id JOIN buildings bu ON bu.id=f.building_id
            JOIN healthcare_units u ON u.id=bu.unit_id
            """+filter,p,(r,n)->{
                long total=r.getLong("total"),blocked=r.getLong("blocked"),occupied=r.getLong("occupied");
                return new BedIndicators(total,total-blocked,r.getLong("available"),occupied,blocked,r.getLong("cleaning"),
                    total==blocked ? null : round(occupied*100d/(total-blocked)));
            });
        StayIndicators stays=jdbc.queryForObject("""
            SELECT count(*) FILTER(WHERE e.status='IN_PROGRESS') AS active,
            count(*) FILTER(WHERE e.start_period>=:from AND e.start_period<:to) AS admissions,
            count(*) FILTER(WHERE e.status='FINISHED' AND e.end_period>=:from AND e.end_period<:to) AS discharges,
            count(*) FILTER(WHERE e.status='FINISHED' AND e.end_period>=:from AND e.end_period<:to AND e.start_period IS NOT NULL) AS los_samples,
            avg(EXTRACT(EPOCH FROM e.end_period-e.start_period)/86400.0)
                FILTER(WHERE e.status='FINISHED' AND e.end_period>=:from AND e.end_period<:to) AS los_days,
            count(*) FILTER(WHERE e.status='IN_PROGRESS' AND EXTRACT(EPOCH FROM :now-e.start_period)>=:longSeconds) AS prolonged,
            max(GREATEST(0,EXTRACT(EPOCH FROM :now-e.start_period)/86400.0)) FILTER(WHERE e.status='IN_PROGRESS' AND e.start_period IS NOT NULL) AS oldest_active,
            count(*) FILTER(WHERE e.status='IN_PROGRESS' AND e.clinical_discharge_at IS NOT NULL) AS clinical_pending,
            max(GREATEST(0,EXTRACT(EPOCH FROM :now-e.clinical_discharge_at)/3600.0))
                FILTER(WHERE e.status='IN_PROGRESS' AND e.clinical_discharge_at IS NOT NULL) AS clinical_oldest,
            count(*) FILTER(WHERE e.status='FINISHED' AND e.end_period>=:from AND e.end_period<:to AND e.clinical_discharge_at IS NOT NULL) AS delay_samples,
            avg(EXTRACT(EPOCH FROM e.end_period-e.clinical_discharge_at)/3600.0)
                FILTER(WHERE e.status='FINISHED' AND e.end_period>=:from AND e.end_period<:to) AS delay_hours,
            count(*) FILTER(WHERE e.status='IN_PROGRESS' AND e.expected_discharge_at>:now AND e.expected_discharge_at<=:next24) AS expected24,
            count(*) FILTER(WHERE e.status='IN_PROGRESS' AND e.expected_discharge_at>:now AND e.expected_discharge_at<=:next48) AS expected48,
            count(*) FILTER(WHERE e.status='IN_PROGRESS' AND e.expected_discharge_at<:now) AS overdue
            FROM encounters e LEFT JOIN clinical_services s ON s.id=e.service_id
            LEFT JOIN floors f ON f.id=s.floor_id LEFT JOIN buildings bu ON bu.id=f.building_id
            LEFT JOIN healthcare_units u ON u.id=bu.unit_id
            """+filter,p,(r,n)->new StayIndicators(r.getLong("active"),r.getLong("admissions"),r.getLong("discharges"),
                r.getLong("los_samples"),number(r,"los_days"),r.getLong("prolonged"),number(r,"oldest_active"),r.getLong("clinical_pending"),
                number(r,"clinical_oldest"),r.getLong("delay_samples"),number(r,"delay_hours"),r.getLong("expected24"),
                r.getLong("expected48"),r.getLong("overdue")));
        WaitingIndicators waiting=jdbc.queryForObject("""
            SELECT count(*) AS pending,count(*) FILTER(WHERE due_at<=:now) AS due,
            count(*) FILTER(WHERE due_at<=:now AND origin='EMERGENCY') AS emergency,
            count(*) FILTER(WHERE EXTRACT(EPOCH FROM :now-due_at)>=:waitSeconds) AS overdue,
            avg(EXTRACT(EPOCH FROM :now-due_at)/3600.0) FILTER(WHERE due_at<=:now) AS average_hours,
            max(EXTRACT(EPOCH FROM :now-due_at)/3600.0) FILTER(WHERE due_at<=:now) AS oldest_hours
            FROM (SELECT q.origin,GREATEST(q.requested_at,COALESCE(q.desired_admission_at,q.requested_at)) AS due_at
                FROM admission_requests q JOIN clinical_services s ON s.id=q.service_id
                JOIN floors f ON f.id=s.floor_id JOIN buildings bu ON bu.id=f.building_id
                JOIN healthcare_units u ON u.id=bu.unit_id
            """+filter+" AND q.status='WAITING') due_requests",p,(r,n)->new WaitingIndicators(r.getLong("pending"),
                r.getLong("due"),r.getLong("emergency"),r.getLong("overdue"),number(r,"average_hours"),number(r,"oldest_hours")));
        return new Indicators(now,from,to,scope,beds,stays,waiting,settings.thresholds());
    }

    public Occupancy occupancy(Scope scope,Instant asOf) {
        validateScope(scope);
        var p=access.parameters();
        if(scope.ulsId()!=null) p.put("uls",scope.ulsId());
        if(scope.unitId()!=null) p.put("unit",scope.unitId());
        if(scope.serviceId()!=null) p.put("service",scope.serviceId());
        String permitted=access.sql("u.uls_id","u.id","s.id");
        String requested=(scope.ulsId()==null ? "" : " AND u.uls_id=:uls")
            +(scope.unitId()==null ? "" : " AND u.id=:unit")
            +(scope.serviceId()==null ? "" : " AND s.id=:service");
        String serviceSql="""
            SELECT s.id,s.name,
                count(*) FILTER(WHERE b.status='OCCUPIED') AS occupied,
                count(*) FILTER(WHERE b.status<>'BLOCKED') AS capacity
            FROM beds b JOIN rooms r ON r.id=b.room_id JOIN wards w ON w.id=r.ward_id
            JOIN wings wi ON wi.id=w.wing_id JOIN clinical_services s ON s.id=wi.service_id
            JOIN floors f ON f.id=s.floor_id JOIN buildings bu ON bu.id=f.building_id
            JOIN healthcare_units u ON u.id=bu.unit_id
            WHERE %s%s GROUP BY s.id,s.name ORDER BY s.name,s.id
            """.formatted(permitted,requested);
        String unitSql="""
            SELECT u.id,u.name,
                count(*) FILTER(WHERE b.status='OCCUPIED') AS occupied,
                count(*) FILTER(WHERE b.status<>'BLOCKED') AS capacity
            FROM beds b JOIN rooms r ON r.id=b.room_id JOIN wards w ON w.id=r.ward_id
            JOIN wings wi ON wi.id=w.wing_id JOIN clinical_services s ON s.id=wi.service_id
            JOIN floors f ON f.id=s.floor_id JOIN buildings bu ON bu.id=f.building_id
            JOIN healthcare_units u ON u.id=bu.unit_id
            WHERE %s%s GROUP BY u.id,u.name ORDER BY u.name,u.id
            """.formatted(permitted,requested);
        var mapper=(org.springframework.jdbc.core.RowMapper<OccupancyRow>)(r,n)->{
            long capacity=r.getLong("capacity"),occupied=r.getLong("occupied");
            return new OccupancyRow(r.getObject("id",UUID.class),r.getString("name"),occupied,capacity,
                capacity==0 ? null : round(occupied*100d/capacity));
        };
        return new Occupancy(asOf,scope,0,jdbc.query(serviceSql,p,mapper),jdbc.query(unitSql,p,mapper));
    }

    public PageResult<ServiceInput> forecastInputs(Scope scope,Instant from,Instant now,int page,int size,AnalyticsSettings settings) {
        HierarchyRepository.page(page,size);
        var p=parameters(scope,from,now,now,settings);
        String filter=where(scope);
        long count=jdbc.queryForObject("SELECT count(*) FROM clinical_services s JOIN floors f ON f.id=s.floor_id"
            + " JOIN buildings bu ON bu.id=f.building_id JOIN healthcare_units u ON u.id=bu.unit_id"+filter,p,Long.class);
        p.put("limit",size); p.put("offset",(long)page*size);
        var inputs=jdbc.query("""
            SELECT s.id,s.name,bs.capacity,bs.occupied,es.unscheduled,es.discharges,es.planned24,es.planned48,qs.pending24,qs.pending48
            FROM (SELECT s.* FROM clinical_services s JOIN floors f ON f.id=s.floor_id
            JOIN buildings bu ON bu.id=f.building_id JOIN healthcare_units u ON u.id=bu.unit_id
            """+filter+" ORDER BY s.code,s.id LIMIT :limit OFFSET :offset) s "+"""
            CROSS JOIN LATERAL (SELECT count(*) FILTER(WHERE b.status<>'BLOCKED') AS capacity,
                count(*) FILTER(WHERE b.status='OCCUPIED') AS occupied FROM beds b
                JOIN rooms r ON r.id=b.room_id JOIN wards w ON w.id=r.ward_id
                JOIN wings wi ON wi.id=w.wing_id WHERE wi.service_id=s.id) bs
            CROSS JOIN LATERAL (SELECT count(*) FILTER(WHERE e.start_period>=:from AND e.start_period<:now
                AND NOT EXISTS(SELECT 1 FROM admission_requests q WHERE q.encounter_id=e.id)) AS unscheduled,
                count(*) FILTER(WHERE e.status='FINISHED' AND e.end_period>=:from AND e.end_period<:now) AS discharges,
                count(*) FILTER(WHERE e.status='IN_PROGRESS' AND e.expected_discharge_at>:now AND e.expected_discharge_at<=:next24) AS planned24,
                count(*) FILTER(WHERE e.status='IN_PROGRESS' AND e.expected_discharge_at>:now AND e.expected_discharge_at<=:next48) AS planned48
                FROM encounters e WHERE e.service_id=s.id) es
            CROSS JOIN LATERAL (SELECT count(*) FILTER(WHERE COALESCE(q.desired_admission_at,q.requested_at)<=:next24) AS pending24,
                count(*) FILTER(WHERE COALESCE(q.desired_admission_at,q.requested_at)<=:next48) AS pending48
                FROM admission_requests q WHERE q.service_id=s.id AND q.status='WAITING') qs
            ORDER BY s.code,s.id
            """,p,(r,n)->new ServiceInput(r.getString("name"),new ForecastInput(r.getObject("id",UUID.class),r.getLong("capacity"),
                r.getLong("occupied"),r.getLong("unscheduled"),r.getLong("discharges"),r.getLong("pending24"),r.getLong("pending48"),
                r.getLong("planned24"),r.getLong("planned48"))));
        return new PageResult<>(inputs,page,size,count,(count+size-1)/size);
    }

    public List<Candidate> candidates(UUID service,UUID preferredWard) {
        access.service(service);
        var p=access.parameters(); p.put("serviceId",service); p.put("preferred",preferredWard);
        var result=jdbc.query("""
            SELECT b.id,b.code,r.code AS room_code,w.code AS ward_code,w.id AS ward_id,
                (SELECT count(*) FROM beds rb WHERE rb.room_id=r.id AND rb.status='OCCUPIED') AS room_occupied
            FROM beds b JOIN rooms r ON r.id=b.room_id JOIN wards w ON w.id=r.ward_id
            JOIN wings wi ON wi.id=w.wing_id
            WHERE wi.service_id=:serviceId AND b.status='AVAILABLE' ORDER BY w.code,r.code,b.code,b.id LIMIT 5001
            """,p,(r,n)->new Candidate(r.getObject("id",UUID.class),r.getString("ward_code"),r.getString("room_code"),
                r.getString("code"),r.getLong("room_occupied"),Objects.equals(preferredWard,r.getObject("ward_id",UUID.class))));
        if(result.size()>5000) throw new IllegalArgumentException("Máximo de 5000 camas candidatas por serviço");
        return result;
    }
    public boolean activeStay(UUID patient) {
        return jdbc.queryForObject("SELECT count(*) FROM encounters WHERE patient_id=:patient AND status='IN_PROGRESS'",Map.of("patient",patient),Long.class)>0;
    }
    public void preferredWard(UUID ward,UUID service) {
        access.requireHierarchy(HierarchyRepository.Type.WARD,ward);
        if(!jdbc.queryForObject("SELECT wi.service_id=:service FROM wards w JOIN wings wi ON wi.id=w.wing_id"
            + " WHERE w.id=:ward",Map.of("service",service,"ward",ward),Boolean.class))
            throw new IllegalArgumentException("A enfermaria preferida deve pertencer ao serviço solicitado");
    }
    public static double round(double value) { return Math.round(value*100d)/100d; }
    private static Double number(ResultSet r,String field) throws SQLException {
        double value=r.getDouble(field); return r.wasNull() ? null : round(value);
    }
}
