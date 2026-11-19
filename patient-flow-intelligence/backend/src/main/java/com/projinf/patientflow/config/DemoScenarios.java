package com.projinf.patientflow.config;

import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Opt-in, transactional, repeatable demonstration data. Never resets existing data or grants access. */
@Component
@Order(10)
public class DemoScenarios implements CommandLineRunner {
    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final boolean enabled;
    public DemoScenarios(JdbcTemplate jdbc,Clock clock,@Value("${patientflow.demo-scenarios:false}") boolean enabled) {
        this.jdbc=jdbc; this.clock=clock; this.enabled=enabled;
    }
    @Override @Transactional
    public void run(String... args) { if(enabled) seed(); }

    @Transactional
    public void seed() {
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended('patientflow:demo:v1',0))::text",String.class);
        UUID uls=id("uls");
        if(jdbc.queryForObject("SELECT count(*) FROM uls WHERE id=?",Long.class,uls)>0) return;
        Instant now=clock.instant().truncatedTo(ChronoUnit.MICROS);
        jdbc.update("INSERT INTO uls(id,name) VALUES(?,?)",uls,"ULS Demonstração");
        UUID centro=unit("centro","Hospital Demonstração Centro",uls);
        UUID norte=unit("norte","Hospital Demonstração Norte",uls);
        UUID pressure=service("pressure","DEMO-MED","Medicina — pressão assistencial",centro);
        UUID recovery=service("recovery","DEMO-ORT","Ortopedia — recuperação",centro);
        UUID stable=service("stable","DEMO-NORTE","Medicina — capacidade disponível",norte);
        UUID pressureRoom=room("pressure",pressure);
        UUID recoveryRoom=room("recovery",recovery);
        UUID stableRoom=room("stable",stable);
        for(int i=0;i<8;i++) {
            String key="pressure-"+i;
            UUID bed=bed(key,pressureRoom,i==7?"BLOCKED":"OCCUPIED");
            if(i<7) {
                Instant start=now.minus(Duration.ofDays(2+i*3));
                Instant clinical=i<2?now.minus(Duration.ofHours(10+i)):null;
                Instant expected=i==0?now.minus(Duration.ofHours(2)):now.plus(Duration.ofHours(12+i));
                stay(key,pressure,bed,start,null,clinical,expected);
            }
        }
        for(int i=0;i<8;i++) {
            String state=i<2?"OCCUPIED":i<4?"CLEANING":i==4?"BLOCKED":"AVAILABLE";
            UUID bed=bed("recovery-"+i,recoveryRoom,state);
            if(i<2) stay("recovery-"+i,recovery,bed,now.minus(Duration.ofDays(3+i)),null,null,now.plus(Duration.ofHours(18+i)));
        }
        for(int i=0;i<6;i++) {
            UUID bed=bed("stable-"+i,stableRoom,i==0?"OCCUPIED":i==1?"CLEANING":"AVAILABLE");
            if(i==0) stay("stable-0",stable,bed,now.minus(Duration.ofDays(1)),null,null,now.plus(Duration.ofHours(30)));
        }
        String[] demoDiagnoses = {"J18.9", "I50.9", "K80.20", "I63.9", "N39.0"};
        for(int day=1;day<=14;day++) {
            Instant end=now.minus(Duration.ofDays(day)).minus(Duration.ofHours(2));
            stay("history-pressure-"+day,pressure,id("bed-pressure-7"),end.minus(Duration.ofHours(12)),end,
                end.minus(Duration.ofHours(2+day%3)),null,demoDiagnoses[day % demoDiagnoses.length]);
            stay("history-recovery-"+day,recovery,id("bed-recovery-"+(5+day%3)),end.minus(Duration.ofDays(2)),end,
                end.minus(Duration.ofHours(1)),null,demoDiagnoses[(day + 1) % demoDiagnoses.length]);
            stay("history-stable-"+day,stable,id("bed-stable-"+(2+day%4)),end.minus(Duration.ofDays(1)),end,null,null,demoDiagnoses[(day + 2) % demoDiagnoses.length]);
        }
        for(int i=0;i<5;i++) request("pressure-"+i,pressure,"EMERGENCY",1+i%3,
            now.minus(Duration.ofHours(6+i*2)),null);
        request("scheduled-pressure",pressure,"SCHEDULED",4,now.minus(Duration.ofDays(2)),now.plus(Duration.ofHours(36)));
        request("recovery",recovery,"SURGICAL",2,now.minus(Duration.ofHours(1)),now.plus(Duration.ofHours(8)));
        request("stable",stable,"EMERGENCY",3,now.minus(Duration.ofHours(1)),null);
    }
    private UUID unit(String key,String name,UUID uls) {
        UUID value=id("unit-"+key); jdbc.update("INSERT INTO healthcare_units(id,name,uls_id) VALUES(?,?,?)",value,name,uls); return value;
    }
    private UUID service(String key,String code,String name,UUID unit) {
        UUID building=id("building-"+key), floor=id("floor-"+key), value=id("service-"+key);
        jdbc.update("INSERT INTO buildings(id,name,unit_id) VALUES(?,?,?)",building,"Edifício demonstração "+key,unit);
        jdbc.update("INSERT INTO floors(id,level_name,building_id) VALUES(?,?,?)",floor,"Piso 1",building);
        jdbc.update("INSERT INTO clinical_services(id,floor_id,code,name) VALUES(?,?,?,?)",value,floor,code,name);
        return value;
    }
    private UUID room(String key,UUID service) {
        UUID wing=id("wing-"+key),ward=id("ward-"+key),room=id("room-"+key);
        jdbc.update("INSERT INTO wings(id,name,service_id) VALUES(?,?,?)",wing,"Ala demonstração "+key,service);
        jdbc.update("INSERT INTO wards(id,code,name,wing_id) VALUES(?,?,?,?)",ward,"Ward DEMO-"+key,"Enfermaria sintética "+key,wing);
        jdbc.update("INSERT INTO rooms(id,code,ward_id) VALUES(?,?,?)",room,"Room DEMO-"+key,ward); return room;
    }
    private UUID bed(String key,UUID room,String state) {
        UUID value=id("bed-"+key);
        jdbc.update("INSERT INTO beds(id,code,room_id,status,status_reason) VALUES(?,?,?,?,?)",value,"Bed DEMO-"+key,room,state,
            state.equals("BLOCKED")?"Manutenção sintética":state.equals("CLEANING")?"Limpeza sintética":null); return value;
    }
    private UUID patient(String key) {
        UUID value=id("patient-"+key);
        jdbc.update("INSERT INTO patients(id,sns_number,full_name,gender) VALUES(?,?,?,?)",value,"DEMO-SNS-"+key,"Doente sintético "+key,"unknown"); return value;
    }
    private void stay(String key,UUID service,UUID bed,Instant start,Instant end,Instant clinical,Instant expected) {
        stay(key,service,bed,start,end,clinical,expected,null);
    }
    private void stay(String key,UUID service,UUID bed,Instant start,Instant end,Instant clinical,Instant expected,String diagnosis) {
        UUID encounter=id("encounter-"+key);
        jdbc.update("INSERT INTO encounters(id,visit_number,patient_id,status,start_period,end_period,clinical_discharge_at,expected_discharge_at,service_id,diagnosis_code)"
            +" VALUES(?,?,?,?,?,?,?,?,?,?)",encounter,"DEMO-VISIT-"+key,patient(key),end==null?"IN_PROGRESS":"FINISHED",at(start),at(end),at(clinical),at(expected),service,diagnosis);
        jdbc.update("INSERT INTO location_allocations(id,encounter_id,bed_id,assigned_at,discharged_at) VALUES(?,?,?,?,?)",
            id("allocation-"+key),encounter,bed,at(start),at(end));
    }
    private void request(String key,UUID service,String origin,int priority,Instant requested,Instant desired) {
        jdbc.update("INSERT INTO admission_requests(id,request_number,patient_id,service_id,origin,priority,requested_at,desired_admission_at,status)"
            +" VALUES(?,?,?,?,?,?,?,?, 'WAITING')",id("request-"+key),"DEMO-REQUEST-"+key,patient("waiting-"+key),service,origin,priority,at(requested),at(desired));
    }
    private UUID id(String key) { return UUID.nameUUIDFromBytes(("patientflow:demo:v1:"+key).getBytes(StandardCharsets.UTF_8)); }
    private Timestamp at(Instant value) { return value==null?null:Timestamp.from(value); }
}
