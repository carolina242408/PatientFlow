// package com.projinf.patientflow.config;

// import com.projinf.patientflow.domain.model.Bed;
// import com.projinf.patientflow.domain.model.Building;
// import com.projinf.patientflow.domain.model.Floor;
// import com.projinf.patientflow.domain.model.HealthcareUnit;
// import com.projinf.patientflow.domain.model.ULS;
// import com.projinf.patientflow.domain.model.Ward;
// import com.projinf.patientflow.domain.model.Wing;
// import com.projinf.patientflow.domain.model.Room;
// import com.projinf.patientflow.domain.model.ClinicalService;
// import jakarta.persistence.EntityManager;
// import com.projinf.patientflow.repository.jpa.ULSJpaRepository;
// import org.springframework.boot.CommandLineRunner;
// import org.springframework.core.annotation.Order;
// import org.springframework.stereotype.Component;
// import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
// import org.springframework.transaction.annotation.Transactional;

// /** Optional synthetic hierarchy for the standalone demo profile. */
// @Component
// @Order(0)
// @ConditionalOnProperty(name = "patientflow.demo-data", havingValue = "true")
// public class DataSeeder implements CommandLineRunner {

//     private final ULSJpaRepository ulsRepository;
//     private final EntityManager entities;

//     public DataSeeder(ULSJpaRepository ulsRepository, EntityManager entities) {
//         this.ulsRepository = ulsRepository;
//         this.entities = entities;
//     }

//     @Override
//     @Transactional
//     public void run(String... args) {
//         if (ulsRepository.count() > 0) return;

//         ULS uls = new ULS();
//         uls.setName("ULS Exemplo");

//         HealthcareUnit unit = new HealthcareUnit();
//         unit.setName("Hospital Principal");
//         uls.addUnit(unit);

//         Building building = new Building();
//         building.setName("Edifício A");
//         unit.addBuilding(building);

//         Floor floor = new Floor();
//         floor.setLevelName("Piso 3");
//         building.addFloor(floor);

//         Wing wing = new Wing();
//         wing.setName("Ala Norte");
//         floor.addWing(wing);

//         ulsRepository.saveAndFlush(uls);
//         ClinicalService service = new ClinicalService();
//         service.setUnit(unit);
//         service.setCode("MED");
//         service.setName("Medicina Interna");
//         entities.persist(service);

//         Ward ward = new Ward();
//         ward.setCode("Ward 30004");
//         ward.setName("Medicina Interna");
//         ward.setService(service);
//         wing.addWard(ward);

//         Room room = new Room();
//         room.setCode("Room 7005");
//         ward.addRoom(room);

//         for (String code : new String[]{"Bed MAC", "Bed MAD"}) {
//             Bed bed = new Bed();
//             bed.setCode(code);
//             room.addBed(bed);
//         }

//         entities.persist(ward);
//     }
// }
