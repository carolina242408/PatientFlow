package com.projinf.patientflow;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.hasItem;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.projinf.patientflow.domain.model.BedStatus;
import com.projinf.patientflow.repository.jpa.BedJpaRepository;
import com.projinf.patientflow.config.DataSeeder;
import java.util.*;
import java.util.concurrent.*;
import java.time.Instant;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import com.projinf.patientflow.service.OperationalService;
import com.projinf.patientflow.dto.OperationalDTO.BedState;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.core.io.ClassPathResource;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.flywaydb.core.Flyway;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

@SpringBootTest(properties = {"patientflow.demo-data=true","patientflow.algorithms.url=http://127.0.0.1:1"}, webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@Testcontainers
class PatientflowApplicationTests {
    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate database;
    @Autowired BedJpaRepository beds;
    @Autowired DataSeeder seeder;
    @Autowired com.projinf.patientflow.config.DemoScenarios scenarios;
    @MockitoBean JwtDecoder decoder;
    @MockitoBean java.time.Clock analyticsClock;
    @Value("${local.server.port}") int port;
    @Autowired PlatformTransactionManager transactions;
    @Autowired OperationalService operations;
    final JsonMapper json = JsonMapper.builder().build();

    @BeforeEach
    void resetClinicalData() {
        when(analyticsClock.instant()).thenReturn(Instant.parse("2026-10-25T12:00:00Z"));
        database.execute("TRUNCATE TABLE user_scope_grants, admission_requests, location_allocations, encounters, patients, beds, rooms, "
            + "wards, clinical_services, wings, floors, buildings, healthcare_units, uls");
        seeder.run();
    }

    @Test
    void demoScenariosCoverPressureRecoveryAndCoherentAllocationHistory() throws Exception {
        scenarios.seed();
        assertThat(count("beds")).isEqualTo(24);
        assertThat(count("patients")).isEqualTo(60);
        assertThat(count("encounters")).isEqualTo(52);
        assertThat(count("admission_requests")).isEqualTo(8);
        assertThat(count("user_scope_grants")).isZero();
        assertThat(database.queryForObject("SELECT count(*) FROM beds WHERE status='OCCUPIED'",Long.class)).isEqualTo(10);
        assertThat(database.queryForObject("SELECT count(*) FROM beds WHERE status='AVAILABLE'",Long.class)).isEqualTo(9);
        assertThat(database.queryForObject("SELECT count(*) FROM beds WHERE status='CLEANING'",Long.class)).isEqualTo(3);
        assertThat(database.queryForObject("SELECT count(*) FROM beds WHERE status='BLOCKED'",Long.class)).isEqualTo(2);
        assertThat(database.queryForObject("SELECT count(*) FROM location_allocations a JOIN location_allocations b "
            +"ON a.bed_id=b.bed_id AND a.id<b.id WHERE a.assigned_at<COALESCE(b.discharged_at,'infinity'::timestamptz) "
            +"AND b.assigned_at<COALESCE(a.discharged_at,'infinity'::timestamptz)",Long.class)).isZero();
        assertThat(database.queryForObject("SELECT count(*) FROM beds b WHERE (b.status='OCCUPIED') <> "
            +"EXISTS(SELECT 1 FROM location_allocations a WHERE a.bed_id=b.id AND a.discharged_at IS NULL)",Long.class)).isZero();
        String service=database.queryForObject("SELECT id::text FROM clinical_services WHERE code='DEMO-MED'",String.class);
        mvc.perform(get("/api/analytics/indicators?serviceId="+service).with(admin()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.beds.occupancyPercent").value(100.0))
            .andExpect(jsonPath("$.waiting.dueNow").value(5));
        mvc.perform(get("/api/analytics/alerts?serviceId="+service).with(admin()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.alerts[*].severity").value(hasItem("CRITICAL")));
    }

    @Test
    void demoScenariosAreRepeatableAndPreserveOperationalChanges() {
        scenarios.seed();
        database.update("UPDATE beds SET status_reason='Intervenção manual' WHERE code='Bed DEMO-pressure-7'");
        scenarios.seed();
        assertThat(count("beds")).isEqualTo(24);
        assertThat(count("location_allocations")).isEqualTo(52);
        assertThat(count("admission_requests")).isEqualTo(8);
        assertThat(database.queryForObject("SELECT status_reason FROM beds WHERE code='Bed DEMO-pressure-7'",String.class))
            .isEqualTo("Intervenção manual");
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "-locations"})
    void admissionAndDischargePersistHistory(String suffix) throws Exception {
        send(example("admission" + suffix + ".json"), 204);
        assertThat(bedStatus()).isEqualTo(BedStatus.OCCUPIED);
        assertThat(count("patients")).isEqualTo(1);
        assertThat(count("encounters")).isEqualTo(1);
        assertThat(database.queryForObject("SELECT count(*) FROM location_allocations WHERE discharged_at IS NULL", Long.class))
            .isEqualTo(1);
        send(example("discharge" + suffix + ".json"), 204);
        assertThat(bedStatus()).isEqualTo(BedStatus.CLEANING);
        assertThat(count("location_allocations")).isEqualTo(1);
        assertThat(database.queryForObject("SELECT status FROM encounters", String.class)).isEqualTo("FINISHED");
        assertThat(database.queryForObject("SELECT discharged_at = (SELECT end_period FROM encounters) FROM location_allocations",
            Boolean.class)).isTrue();
    }

    @Test
    void relatesSamplesByVisitNumberDespiteDifferentFhirResourceIds() throws Exception {
        send(example("admission.json"), 204);
        send(example("discharge.json"), 204);
        assertThat(count("encounters")).isEqualTo(1);
        assertThat(count("patients")).isEqualTo(1);
        assertThat(database.queryForObject("SELECT visit_number FROM encounters", String.class)).isEqualTo("99000999");
    }

    @Test
    void supportsFhirMediaType() throws Exception {
        mvc.perform(post("/api/fhir/bundles").with(admin()).contentType("application/fhir+json")
            .content(example("admission.json"))).andExpect(status().isNoContent());
    }

    @Test
    void preservesAuthenticationAndPublicHealth() throws Exception {
        mvc.perform(post("/api/fhir/bundles").contentType(MediaType.APPLICATION_JSON)
            .content(example("admission.json"))).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/account")).andExpect(status().isUnauthorized());
        mvc.perform(get("/actuator/health")).andExpect(status().isOk());
        assertThat(count("patients")).isZero();
    }

    @Test
    void preservesKeycloakRoleConversionAndAccount() throws Exception {
        when(decoder.decode("test-token")).thenReturn(Jwt.withTokenValue("test-token").header("alg", "none")
            .subject("tester").claim("preferred_username", "gestor")
            .claim("name", "Gestor Teste").claim("email", "gestor@example.test")
            .claim("realm_access", java.util.Map.of("roles", java.util.List.of("MANAGER"))).build());
        mvc.perform(get("/api/account").header("Authorization", "Bearer test-token"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.login").value("gestor"))
            .andExpect(jsonPath("$.roles").value(hasItem("MANAGER")));
    }

    @Test
    void malformedAndUnsupportedInputReturnProblemDetailsWithoutWrites() throws Exception {
        for (String body : new String[]{"{", "{}", example("admission.json").replace("in-progress", "cancelled")}) {
            mvc.perform(post("/api/fhir/bundles").with(admin()).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest()).andExpect(content().contentTypeCompatibleWith("application/problem+json"))
                .andExpect(jsonPath("$.status").value(400)).andExpect(jsonPath("$.detail").isNotEmpty());
        }
        assertThat(count("patients")).isZero();
        assertThat(count("encounters")).isZero();
    }

    @Test
    void unknownBedOrEncounterReturn404() throws Exception {
        send(example("admission.json").replace("Bed MAC", "Bed UNKNOWN"), 404);
        send(example("discharge.json"), 404);
        assertThat(count("patients")).isZero();
        assertThat(count("encounters")).isZero();
    }

    @Test
    void duplicateAdmissionIsIdempotentAndOccupiedBedReturns409WithoutPartialWrites() throws Exception {
        String admission = example("admission.json");
        send(admission, 204);
        send(admission, 204);
        send(admission.replace("99000999", "OTHER-VISIT").replace("999999999", "888888888"), 409);
        assertThat(count("patients")).isEqualTo(1);
        assertThat(count("encounters")).isEqualTo(1);
        assertThat(count("location_allocations")).isEqualTo(1);
    }

    @Test
    void rejectsWrongPatientAndWrongBedOnDischarge() throws Exception {
        send(example("admission.json"), 204);
        send(example("discharge.json").replace("999999999", "888888888"), 409);
        send(example("discharge.json").replace("Bed MAC", "Bed MAD"), 409);
        assertThat(bedStatus()).isEqualTo(BedStatus.OCCUPIED);
        assertThat(database.queryForObject("SELECT status FROM encounters", String.class)).isEqualTo("IN_PROGRESS");
    }

    @Test
    void rejectsDischargeBeforeStoredAdmission() throws Exception {
        send(example("admission.json"), 204);
        String discharge = example("discharge.json").replace("\"start\": \"2019-01-18T15:04:00Z\"",
            "\"end\": \"2018-01-18T15:04:00Z\"");
        send(discharge, 400);
        assertThat(bedStatus()).isEqualTo(BedStatus.OCCUPIED);
    }

    @Test
    void databaseEnforcesExclusiveOpenAllocationsAndForeignKeys() throws Exception {
        send(example("admission.json"), 204);
        assertThatThrownBy(() -> database.update("""
            INSERT INTO location_allocations (id, encounter_id, bed_id, assigned_at)
            SELECT gen_random_uuid(), encounter_id, bed_id, assigned_at FROM location_allocations
            """)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> database.update("""
            INSERT INTO rooms (id, code, ward_id) VALUES (gen_random_uuid(), 'ORPHAN', gen_random_uuid())
            """)).isInstanceOf(DataIntegrityViolationException.class);
        assertThat(count("location_allocations")).isEqualTo(1);
    }

    private BedStatus bedStatus() {
        return beds.findByHierarchy("Ward 30004", "Room 7005", "Bed MAC").orElseThrow().getStatus();
    }

    @Test
    void exclusiveAllocationConstraintsApplyIndependently() throws Exception {
        send(example("admission.json"), 204);
        assertThatThrownBy(() -> database.update("""
            INSERT INTO location_allocations (id, encounter_id, bed_id, assigned_at)
            SELECT gen_random_uuid(), a.encounter_id, b.id, a.assigned_at
            FROM location_allocations a CROSS JOIN beds b WHERE b.code = 'Bed MAD'
            """)).isInstanceOf(DataIntegrityViolationException.class);
        database.update("""
            INSERT INTO encounters (id, visit_number, patient_id, status, start_period)
            SELECT gen_random_uuid(), 'SECOND-VISIT', patient_id, 'FINISHED', start_period FROM encounters
            """);
        assertThatThrownBy(() -> database.update("""
            INSERT INTO location_allocations (id, encounter_id, bed_id, assigned_at)
            SELECT gen_random_uuid(), e.id, a.bed_id, a.assigned_at
            FROM encounters e CROSS JOIN location_allocations a WHERE e.visit_number = 'SECOND-VISIT'
            """)).isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void newVisitReusesPatientAndKeepsClosedBedHistory() throws Exception {
        send(example("admission.json"), 204);
        send(example("discharge.json"), 204);
        setBed("Bed MAC", "AVAILABLE");
        send(example("admission.json").replace("99000999", "NEW-VISIT"), 204);
        assertThat(count("patients")).isEqualTo(1);
        assertThat(count("encounters")).isEqualTo(2);
        assertThat(count("location_allocations")).isEqualTo(2);
        assertThat(bedStatus()).isEqualTo(BedStatus.OCCUPIED);
    }

    private long count(String table) {
        return database.queryForObject("SELECT count(*) FROM " + table, Long.class);
    }

    private String example(String name) throws Exception {
        return new ClassPathResource("fhir/" + name).getContentAsString(StandardCharsets.UTF_8);
    }

    private void send(String body, int expectedStatus) throws Exception {
        mvc.perform(post("/api/fhir/bundles").with(admin()).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().is(expectedStatus));
    }

    @Test
    void idempotentDischargeAndDelayedAdmissionNeverReopenOrFreeAnotherStay() throws Exception {
        send(example("admission.json"), 204);
        send(example("discharge.json"), 204);
        send(example("discharge.json"), 204);
        send(example("admission.json"), 204);
        assertThat(bedStatus()).isEqualTo(BedStatus.CLEANING);
        setBed("Bed MAC", "AVAILABLE");
        send(example("admission.json").replace("99000999", "NEW-VISIT").replace("999999999", "888888888"), 204);
        send(example("discharge.json"), 204);
        assertThat(bedStatus()).isEqualTo(BedStatus.OCCUPIED);
        assertThat(count("location_allocations")).isEqualTo(2);
    }

    @Test
    void contradictoryReplaysAreRejected() throws Exception {
        send(example("admission.json"), 204);
        send(example("admission.json").replace("Bed MAC", "Bed MAD"), 409);
        send(example("admission.json").replace("2019-01-18T15:04:00Z", "2019-01-19T15:04:00Z"), 409);
        send(example("discharge-locations.json").replace("V-2026-0001", "99000999").replace("123456789", "999999999"), 409);
        String discharge = example("discharge.json").replace("\"start\": \"2019-01-18T15:04:00Z\"",
            "\"start\": \"2019-01-18T15:04:00Z\", \"end\": \"2026-10-23T12:00:00Z\"");
        send(discharge, 204);
        send(discharge.replace("2026-10-23T12:00:00Z", "2026-10-24T12:00:00Z"), 409);
        assertThat(count("location_allocations")).isEqualTo(1);
    }

    @Test
    void outOfOrderDischargeCanBeRetriedAfterAdmission() throws Exception {
        send(example("discharge.json"), 404);
        assertThat(count("patients")).isZero();
        send(example("admission.json"), 204);
        send(example("discharge.json"), 204);
        assertThat(bedStatus()).isEqualTo(BedStatus.CLEANING);
    }

    @Test
    void concurrentEquivalentAdmissionsAndDischargesHaveOneEffect() throws Exception {
        String admission = example("admission.json");
        assertThat(race(() -> fhir(admission), () -> fhir(admission))).containsExactlyInAnyOrder(204, 204);
        assertThat(count("patients")).isEqualTo(1);
        assertThat(count("encounters")).isEqualTo(1);
        assertThat(count("location_allocations")).isEqualTo(1);
        String discharge = example("discharge.json");
        assertThat(race(() -> fhir(discharge), () -> fhir(discharge))).containsExactlyInAnyOrder(204, 204);
        assertThat(bedStatus()).isEqualTo(BedStatus.CLEANING);
    }

    @Test
    void concurrentAdmissionsCompetingForBedHaveOneWinnerAndNoPartialPatient() throws Exception {
        String first = example("admission.json");
        String second = first.replace("99000999", "SECOND").replace("999999999", "888888888");
        assertThat(race(() -> fhir(first), () -> fhir(second))).containsExactlyInAnyOrder(204, 409);
        assertThat(count("patients")).isEqualTo(1);
        assertThat(count("encounters")).isEqualTo(1);
        assertThat(count("location_allocations")).isEqualTo(1);
    }

    @Test
    void concurrentAdmissionsOfSamePatientCannotCreateTwoActiveStays() throws Exception {
        String first = example("admission.json");
        String second = first.replace("99000999", "SECOND").replace("Bed MAC", "Bed MAD");
        assertThat(race(() -> fhir(first), () -> fhir(second))).containsExactlyInAnyOrder(204, 409);
        assertThat(count("patients")).isEqualTo(1);
        assertThat(count("encounters")).isEqualTo(1);
    }

    @Test
    void concurrentBedBlockingAndAdmissionCannotProduceBlockedOccupiedBed() throws Exception {
        String admission = example("admission.json");
        UUID bed = bedId("Bed MAC");
        var statuses = race(() -> fhir(admission), () -> put("/api/beds/" + bed + "/status")
            .content(json.writeValueAsString(Map.of("status", "BLOCKED", "version", 0, "reason", "Maintenance"))));
        assertThat(statuses).contains(409);
        assertThat(statuses).containsAnyOf(200, 204);
        String state = database.queryForObject("SELECT status FROM beds WHERE id=?", String.class, bed);
        assertThat(state).isIn("OCCUPIED", "BLOCKED");
        assertThat(count("encounters")).isEqualTo(state.equals("OCCUPIED") ? 1 : 0);
    }

    @Test
    void bedStateTransitionsRequireVersionAndReasonAndCleaningBeforeReuse() throws Exception {
        UUID bed = bedId("Bed MAC");
        call(put("/api/beds/" + bed + "/status"), Map.of("status", "BLOCKED", "version", 0), 400);
        var blocked = call(put("/api/beds/" + bed + "/status"),
            Map.of("status", "BLOCKED", "version", 0, "reason", "Maintenance"), 200);
        assertThat(blocked.path("reason").asString()).isEqualTo("Maintenance");
        call(put("/api/beds/" + bed + "/status"), Map.of("status", "AVAILABLE", "version", 0), 409);
        send(example("admission.json"), 409);
        setBed("Bed MAC", "AVAILABLE");
        send(example("admission.json"), 204);
        call(put("/api/beds/" + bed + "/status"),
            Map.of("status", "AVAILABLE", "version", getJson("/api/beds/" + bed).path("version").asLong()), 409);
        send(example("discharge.json"), 204);
        send(example("admission.json").replace("99000999", "SECOND"), 409);
        setBed("Bed MAC", "AVAILABLE");
        send(example("admission.json").replace("99000999", "SECOND"), 204);
    }

    @Test
    void bedMapAndScopedPaginatedQueriesExposeOccupantAndDischargePlan() throws Exception {
        send(example("admission.json"), 204);
        UUID encounter = onlyId("encounters");
        call(put("/api/encounters/" + encounter + "/discharge-plan"),
            Map.of("version", 0, "expectedDischargeAt", "2026-10-27T12:00:00Z"), 200);
        UUID service = onlyId("clinical_services");
        UUID unit = onlyId("healthcare_units");
        UUID ward = onlyId("wards");
        var map = getJson("/api/bed-map?serviceId=" + service + "&size=1");
        assertThat(map.path("counts").path("AVAILABLE").asInt()).isEqualTo(1);
        assertThat(map.path("counts").path("OCCUPIED").asInt()).isEqualTo(1);
        assertThat(map.path("beds").path("totalElements").asInt()).isEqualTo(2);
        assertThat(getJson("/api/beds?status=OCCUPIED&wardId=" + ward).path("content").path(0)
            .path("expectedDischargeAt").asString()).isEqualTo("2026-10-27T12:00:00Z");
        assertThat(getJson("/api/patients?q=LAST_NAMES&unitId=" + unit).path("totalElements").asInt()).isEqualTo(1);
        assertThat(getJson("/api/encounters?serviceId=" + service).path("totalElements").asInt()).isEqualTo(1);
        assertThat(getJson("/api/allocations?active=true&wardId=" + ward).path("totalElements").asInt()).isEqualTo(1);
        assertThat(getJson("/api/beds?unitId=" + UUID.randomUUID()).path("totalElements").asInt()).isZero();
        mvc.perform(get("/api/beds?size=101").with(admin())).andExpect(status().isBadRequest());
        mvc.perform(get("/api/beds?page=-1").with(admin())).andExpect(status().isBadRequest());
    }

    @Test
    void clinicalAndAdministrativeDischargePreserveChronologyAndVersions() throws Exception {
        send(example("admission.json"), 204);
        UUID id = onlyId("encounters");
        call(put("/api/encounters/" + id + "/discharge-plan"),
            Map.of("version", 0, "expectedDischargeAt", "2018-01-01T00:00:00Z"), 400);
        var planned = call(put("/api/encounters/" + id + "/discharge-plan"),
            Map.of("version", 0, "expectedDischargeAt", "2026-10-25T12:00:00Z"), 200);
        call(post("/api/encounters/" + id + "/clinical-discharge"), Map.of("version", 0), 409);
        var clinical = call(post("/api/encounters/" + id + "/clinical-discharge"),
            Map.of("version", planned.path("version").asLong(), "at", "2026-10-24T12:00:00Z"), 200);
        assertThat(bedStatus()).isEqualTo(BedStatus.OCCUPIED);
        call(post("/api/encounters/" + id + "/administrative-discharge"),
            Map.of("version", clinical.path("version").asLong(), "at", "2026-10-23T12:00:00Z"), 400);
        var finished = call(post("/api/encounters/" + id + "/administrative-discharge"),
            Map.of("version", clinical.path("version").asLong(), "at", "2026-10-24T14:00:00Z"), 200);
        assertThat(finished.path("administrativeDischargeAt").asString()).isEqualTo("2026-10-24T14:00:00Z");
        assertThat(finished.path("clinicalDischargeAt").asString()).isEqualTo("2026-10-24T12:00:00Z");
        assertThat(bedStatus()).isEqualTo(BedStatus.CLEANING);
        call(post("/api/encounters/" + id + "/clinical-discharge"),
            Map.of("version", planned.path("version").asLong(), "at", "2026-10-24T12:00:00Z"), 200);
        call(post("/api/encounters/" + id + "/administrative-discharge"),
            Map.of("version", clinical.path("version").asLong(), "at", "2026-10-24T14:00:00Z"), 200);
        call(put("/api/encounters/" + id + "/discharge-plan"),
            Map.of("version", finished.path("version").asLong()), 409);
    }

    @Test
    void demographicsAreUpdatedExplicitlyAndNotOverwrittenByFhirReplays() throws Exception {
        send(example("admission.json"), 204);
        UUID patient = onlyId("patients");
        call(put("/api/patients/" + patient), Map.of("version", 0, "fullName", "Corrected Name", "gender", "other"), 200);
        send(example("admission.json"), 204);
        assertThat(getJson("/api/patients/" + patient).path("fullName").asString()).isEqualTo("Corrected Name");
        call(put("/api/patients/" + patient), Map.of("version", 0, "fullName", "Stale Name"), 409);
        call(post("/api/patients"), Map.of("snsNumber", "999999999", "fullName", "Duplicate"), 409);
    }

    @Test
    void hierarchyCrudPreservesParentServiceAndHistoryConstraints() throws Exception {
        var root = node("ULS", "Test ULS", null, null, null);
        UUID rootId = UUID.fromString(root.path("id").asString());
        UUID unit = id(node("UNIT", "Test Unit", null, rootId, null));
        UUID building = id(node("BUILDING", "Test Building", null, unit, null));
        UUID floor = id(node("FLOOR", "Test Floor", null, building, null));
        UUID wing = id(node("WING", "Test Wing", null, floor, null));
        UUID service = id(node("SERVICE", "Test Service", "TEST", unit, null));
        call(post("/api/hierarchy/WARD"), Map.of("name", "Bad", "code", "BAD", "parentId", wing,
            "serviceId", onlyId("clinical_services", "code='MED'")), 409);
        UUID ward = id(node("WARD", "Test Ward", "TEST-WARD", wing, service));
        UUID room = id(node("ROOM", null, "TEST-ROOM", ward, null));
        UUID bed = id(node("BED", null, "TEST-BED", room, null));
        assertThat(getJson("/api/beds?serviceId=" + service).path("totalElements").asInt()).isEqualTo(1);
        assertThat(getJson("/api/hierarchy/WARD?parentId=" + wing).path("content").path(0).path("serviceId").asString())
            .isEqualTo(service.toString());
        call(put("/api/hierarchy/WARD/" + ward), Map.of("name", "Renamed Ward"), 200);
        call(put("/api/hierarchy/WARD/" + ward), Map.of("name", "Move", "parentId", onlyId("wings", "id<>'" + wing + "'")), 409);
        mvc.perform(delete("/api/hierarchy/ULS/" + rootId).with(admin())).andExpect(status().isConflict());
        mvc.perform(delete("/api/hierarchy/BED/" + bed).with(admin())).andExpect(status().isNoContent());
        send(example("admission.json"), 204);
        mvc.perform(delete("/api/hierarchy/BED/" + bedId("Bed MAC")).with(admin())).andExpect(status().isConflict());
        mvc.perform(get("/api/hierarchy/UNKNOWN").with(admin())).andExpect(status().isBadRequest());
    }

    @Test
    void pendingRequestsSupportPriorityOriginAdmissionAndCancellation() throws Exception {
        UUID patient = id(call(post("/api/patients"), Map.of("snsNumber", "QUEUE-SNS", "fullName", "Queue Patient"), 201));
        UUID service = onlyId("clinical_services");
        var created = call(post("/api/admission-requests"), Map.of("requestNumber", "REQ-1", "patientId", patient,
            "serviceId", service, "origin", "EMERGENCY", "priority", 2), 201);
        UUID request = id(created);
        call(post("/api/admission-requests"), Map.of("requestNumber", "REQ-2", "patientId", patient,
            "serviceId", service, "origin", "SCHEDULED", "priority", 1), 409);
        var updated = call(put("/api/admission-requests/" + request), Map.of("version", 0, "priority", 1), 200);
        assertThat(getJson("/api/admission-requests?status=WAITING&origin=EMERGENCY&serviceId=" + service)
            .path("totalElements").asInt()).isEqualTo(1);
        assertThat(getJson("/api/patients?serviceId=" + service).path("totalElements").asInt()).isEqualTo(1);
        var admitted = call(post("/api/admission-requests/" + request + "/admit"), Map.of("version", updated.path("version").asLong(),
            "bedId", bedId("Bed MAC"), "visitNumber", "QUEUED-VISIT"), 200);
        assertThat(admitted.path("status").asString()).isEqualTo("ADMITTED");
        assertThat(admitted.path("encounterId").isNull()).isFalse();
        assertThat(bedStatus()).isEqualTo(BedStatus.OCCUPIED);
        call(post("/api/admission-requests/" + request + "/admit"), Map.of("version", updated.path("version").asLong(),
            "bedId", bedId("Bed MAC"), "visitNumber", "QUEUED-VISIT"), 200);
        call(post("/api/admission-requests/" + request + "/cancel"), Map.of("version", admitted.path("version").asLong()), 409);
        UUID secondPatient = id(call(post("/api/patients"), Map.of("snsNumber", "QUEUE-2", "fullName", "Second Patient"), 201));
        UUID second = id(call(post("/api/admission-requests"), Map.of("requestNumber", "REQ-3", "patientId", secondPatient,
            "serviceId", service, "origin", "SURGICAL", "priority", 3), 201));
        call(post("/api/admission-requests/" + second + "/cancel"), Map.of("version", 0), 200);
        call(post("/api/admission-requests/" + second + "/cancel"), Map.of("version", 0), 200);
        assertThat(getJson("/api/admission-requests?status=CANCELLED").path("totalElements").asInt()).isEqualTo(1);
    }

    @Test
    void failedQueuedAdmissionRollsBackQueueAndEpisode() throws Exception {
        send(example("admission.json"), 204);
        UUID patient = id(call(post("/api/patients"), Map.of("snsNumber", "WAITING", "fullName", "Waiting Patient"), 201));
        UUID request = id(call(post("/api/admission-requests"), Map.of("requestNumber", "WAITING-REQ", "patientId", patient,
            "serviceId", onlyId("clinical_services"), "origin", "EMERGENCY", "priority", 1), 201));
        call(post("/api/admission-requests/" + request + "/admit"), Map.of("version", 0,
            "bedId", bedId("Bed MAC"), "visitNumber", "WAITING-VISIT"), 409);
        assertThat(getJson("/api/admission-requests/" + request).path("status").asString()).isEqualTo("WAITING");
        assertThat(count("encounters")).isEqualTo(1);
        assertThat(count("location_allocations")).isEqualTo(1);
    }

    @Test
    void allOperationalRoutesRequireAuthentication() throws Exception {
        for (String uri : List.of("/api/beds", "/api/bed-map", "/api/patients", "/api/encounters",
                "/api/allocations", "/api/admission-requests", "/api/hierarchy/ULS")) {
            mvc.perform(get(uri)).andExpect(status().isUnauthorized());
        }
    }

    @Test
    void concurrentQueuedAdmissionsAreIdempotent() throws Exception {
        UUID request = waitingRequest();
        String body = json.writeValueAsString(Map.of("version", 0, "bedId", bedId("Bed MAC"), "visitNumber", "QUEUED"));
        assertThat(race(() -> post("/api/admission-requests/" + request + "/admit").content(body),
            () -> post("/api/admission-requests/" + request + "/admit").content(body))).containsExactlyInAnyOrder(200, 200);
        assertThat(count("encounters")).isEqualTo(1);
        assertThat(count("location_allocations")).isEqualTo(1);
    }

    @Test
    void concurrentQueueAdmissionAndCancellationHaveOneWinner() throws Exception {
        UUID request = waitingRequest();
        String admission = json.writeValueAsString(Map.of("version", 0, "bedId", bedId("Bed MAC"), "visitNumber", "QUEUED"));
        String cancel = json.writeValueAsString(Map.of("version", 0));
        assertThat(race(() -> post("/api/admission-requests/" + request + "/admit").content(admission),
            () -> post("/api/admission-requests/" + request + "/cancel").content(cancel))).containsExactlyInAnyOrder(200, 409);
        boolean admitted = getJson("/api/admission-requests/" + request).path("status").asString().equals("ADMITTED");
        assertThat(count("encounters")).isEqualTo(admitted ? 1 : 0);
        assertThat(bedStatus()).isEqualTo(admitted ? BedStatus.OCCUPIED : BedStatus.AVAILABLE);
    }

    @Test
    void concurrentDischargePlanEditsRejectStaleVersion() throws Exception {
        send(example("admission.json"), 204);
        UUID encounter = onlyId("encounters");
        String first = json.writeValueAsString(Map.of("version", 0, "expectedDischargeAt", "2026-10-26T12:00:00Z"));
        String second = json.writeValueAsString(Map.of("version", 0, "expectedDischargeAt", "2026-10-27T12:00:00Z"));
        assertThat(race(() -> put("/api/encounters/" + encounter + "/discharge-plan").content(first),
            () -> put("/api/encounters/" + encounter + "/discharge-plan").content(second))).containsExactlyInAnyOrder(200, 409);
    }

    @Test
    void upgradingExistingV2DataPreservesStayAndBackfillsService() {
        database.execute("CREATE SCHEMA upgrade_test");
        String url = POSTGRES.getJdbcUrl() + (POSTGRES.getJdbcUrl().contains("?") ? "&" : "?") + "currentSchema=upgrade_test";
        var source = new DriverManagerDataSource(url, POSTGRES.getUsername(), POSTGRES.getPassword());
        Flyway.configure().dataSource(source).defaultSchema("upgrade_test").target("2").load().migrate();
        new ResourceDatabasePopulator(new ClassPathResource("db/v2-data.sql")).execute(source);
        var legacy = new JdbcTemplate(source);
        Flyway.configure().dataSource(source).defaultSchema("upgrade_test").load().migrate();
        assertThat(legacy.queryForObject("SELECT count(*) FROM patients", Long.class)).isEqualTo(1);
        assertThat(legacy.queryForObject("SELECT count(*) FROM location_allocations WHERE discharged_at IS NULL", Long.class)).isEqualTo(1);
        assertThat(legacy.queryForObject("SELECT status FROM beds", String.class)).isEqualTo("OCCUPIED");
        assertThat(legacy.queryForObject("SELECT code FROM clinical_services", String.class)).isEqualTo("GENERAL");
        assertThat(legacy.queryForObject("SELECT e.service_id = wi.service_id FROM encounters e CROSS JOIN wards w"
            + " JOIN wings wi ON wi.id=w.wing_id", Boolean.class)).isTrue();
        assertThat(legacy.queryForObject("SELECT max(version::int) FROM flyway_schema_history WHERE success=true", Integer.class)).isEqualTo(5);
    }

    private UUID waitingRequest() throws Exception {
        UUID patient = id(call(post("/api/patients"), Map.of("snsNumber", "QUEUE-SNS", "fullName", "Queue Patient"), 201));
        return id(call(post("/api/admission-requests"), Map.of("requestNumber", "REQ", "patientId", patient,
            "serviceId", onlyId("clinical_services"), "origin", "EMERGENCY", "priority", 1), 201));
    }

    @Test
    void aRoleWithoutAssignmentCannotAccessOperationalData() throws Exception {
        var user=manager("unassigned","MANAGER");
        as(user,get("/api/beds"),null,403);
        as(user,post("/api/events/tickets"),null,403);
        assertThat(as(user,get("/api/access/me"),null,200).path("scopes").size()).isZero();
        as(manager("outsider","ROLE_USER"),get("/api/beds"),null,403);
    }

    @Test
    void scopeAdministrationRequiresAdminAndManagerGroupScopes() throws Exception {
        UUID unit=onlyId("healthcare_units");
        UUID assignment=grant("service-user","UNIT",unit);
        var user=manager("service-user","MANAGER");
        assertThat(as(user,get("/api/beds"),null,200).path("totalElements").asInt()).isEqualTo(2);
        as(user,post("/api/access/grants"),Map.of("subject","service-user","type","ULS","scopeId",onlyId("uls")),403);
        as(user,delete("/api/access/grants/"+assignment),null,403);
        as(user,get("/api/access/grants"),null,403);
        call(post("/api/access/grants"),Map.of("subject","service-user","type","UNIT","scopeId",unit),409);
        call(post("/api/access/grants"),Map.of("subject","unknown","type","SERVICE","scopeId",UUID.randomUUID()),404);
        grant("service-user","SERVICE",onlyId("clinical_services"));
        var serviceUser=manager("service-user","MANAGER");
        assertThat(as(serviceUser,get("/api/access/me"),null,200).path("scopes").size()).isEqualTo(1);
        assertThat(as(serviceUser,get("/api/beds"),null,200).path("totalElements").asInt()).isEqualTo(2);
    }

    @Test
    void unitScopeAppliesToRowsCountsFiltersAndDirectResourceIds() throws Exception {
        var other=topology(onlyId("uls"),null,"SECOND");
        send(example("admission.json"),204);
        String foreign=at(example("admission.json"),"SECOND").replace("99000999","FOREIGN").replace("999999999","888888888");
        send(foreign,204);
        UUID foreignEncounter=onlyId("encounters","visit_number='FOREIGN'");
        UUID foreignPatient=onlyId("patients","sns_number='888888888'");
        grant("unit-user","UNIT",onlyId("healthcare_units","id<>'"+other.unit()+"'"));
        var user=manager("unit-user","MANAGER");
        assertThat(as(user,get("/api/beds"),null,200).path("totalElements").asInt()).isEqualTo(2);
        assertThat(as(user,get("/api/bed-map"),null,200).path("counts").path("OCCUPIED").asInt()).isEqualTo(1);
        assertThat(as(user,get("/api/beds?unitId="+other.unit()),null,200).path("totalElements").asInt()).isZero();
        assertThat(as(user,get("/api/patients"),null,200).path("totalElements").asInt()).isEqualTo(1);
        assertThat(as(user,get("/api/encounters?patientId="+foreignPatient),null,200).path("totalElements").asInt()).isZero();
        assertThat(as(user,get("/api/allocations?bedId="+other.bed()),null,200).path("totalElements").asInt()).isZero();
        as(user,get("/api/beds/"+other.bed()),null,404);
        as(user,get("/api/patients/"+foreignPatient),null,404);
        as(user,get("/api/encounters/"+foreignEncounter),null,404);
        as(user,put("/api/beds/"+other.bed()+"/status"),Map.of("status","AVAILABLE","version",0),404);
        as(user,put("/api/encounters/"+foreignEncounter+"/discharge-plan"),Map.of("version",0),404);
        as(user,post("/api/encounters/"+foreignEncounter+"/clinical-discharge"),Map.of("version",0),404);
        as(user,post("/api/encounters/"+foreignEncounter+"/administrative-discharge"),Map.of("version",0),404);
        as(user,put("/api/patients/"+foreignPatient),Map.of("version",0,"fullName","Forbidden"),403);
        as(user,post("/api/hierarchy/ULS"),Map.of("name","Forbidden"),403);
        as(user,post("/api/patients"),Map.of("snsNumber","Forbidden","fullName","Forbidden"),403);
    }

    @Test
    void serviceScopeIncludesOnlyItsWardsAndActualPhysicalAncestors() throws Exception {
        UUID unit=onlyId("healthcare_units");
        UUID service=onlyId("clinical_services");
        var other=topology(onlyId("uls"),unit,"OTHER");
        grant("service-user","SERVICE",service);
        var user=manager("service-user","MANAGER");
        for(String type:List.of("ULS","UNIT","SERVICE","BUILDING","FLOOR","WING","WARD","ROOM")) {
            assertThat(as(user,get("/api/hierarchy/"+type),null,200).path("totalElements").asInt()).as(type).isEqualTo(1);
        }
        as(user,get("/api/hierarchy/WARD/"+other.ward()),null,404);
        assertThat(as(user,get("/api/beds?serviceId="+other.service()),null,200).path("totalElements").asInt()).isZero();
        as(user,put("/api/beds/"+bedId("Bed MAC")+"/status"),Map.of("version",0,"status","BLOCKED","reason","Maintenance"),200);
        grant("service-user","SERVICE",other.service());
        assertThat(as(user,get("/api/beds"),null,200).path("totalElements").asInt()).isEqualTo(3);
    }

    @Test
    void lhuScopeIncludesChildUnitsAndExcludesOtherUls() throws Exception {
        UUID uls=onlyId("uls");
        topology(uls,null,"CHILD");
        UUID otherUls=id(node("ULS","Outside",null,null,null));
        topology(otherUls,null,"OUTSIDE");
        grant("uls-user","ULS",uls);
        var user=manager("uls-user","MANAGER");
        assertThat(as(user,get("/api/beds"),null,200).path("totalElements").asInt()).isEqualTo(3);
        assertThat(as(user,get("/api/hierarchy/UNIT"),null,200).path("totalElements").asInt()).isEqualTo(2);
        assertThat(as(user,get("/api/hierarchy/ULS"),null,200).path("totalElements").asInt()).isEqualTo(1);
    }

    @Test
    void fhirChecksBothTargetBedAndExistingEncounterScope() throws Exception {
        UUID service=onlyId("clinical_services");
        topology(onlyId("uls"),null,"FOREIGN");
        grant("service-user","SERVICE",service);
        var user=manager("service-user","MANAGER");
        String foreign=at(example("admission.json"),"FOREIGN").replace("99000999","FOREIGN-VISIT").replace("999999999","888888888");
        mvc.perform(fhir(foreign).with(user).contentType(MediaType.APPLICATION_JSON)).andExpect(status().isNotFound());
        assertThat(count("patients")).isZero();
        mvc.perform(fhir(example("admission.json")).with(user).contentType(MediaType.APPLICATION_JSON)).andExpect(status().isNoContent());
        send(foreign,204);
        mvc.perform(fhir(example("admission.json").replace("99000999","FOREIGN-VISIT")).with(user)
            .contentType(MediaType.APPLICATION_JSON)).andExpect(status().isNotFound());
        assertThat(as(user,get("/api/patients"),null,200).path("totalElements").asInt()).isEqualTo(1);
    }

    @Test
    void queueScopeProtectsReadCreateUpdateAdmitAndCancel() throws Exception {
        UUID service=onlyId("clinical_services");
        var other=topology(onlyId("uls"),null,"FOREIGN");
        UUID patient=id(call(post("/api/patients"),Map.of("snsNumber","OUTSIDE","fullName","Outside"),201));
        UUID request=id(call(post("/api/admission-requests"),Map.of("requestNumber","OUTSIDE","patientId",patient,
            "serviceId",other.service(),"priority",1,"origin","EMERGENCY"),201));
        grant("service-user","SERVICE",service);
        var user=manager("service-user","MANAGER");
        assertThat(as(user,get("/api/admission-requests"),null,200).path("totalElements").asInt()).isZero();
        as(user,get("/api/admission-requests/"+request),null,404);
        as(user,put("/api/admission-requests/"+request),Map.of("version",0,"priority",2),404);
        as(user,post("/api/admission-requests/"+request+"/cancel"),Map.of("version",0),404);
        as(user,post("/api/admission-requests/"+request+"/admit"),
            Map.of("version",0,"bedId",other.bed(),"visitNumber","FORBIDDEN"),404);
        as(user,post("/api/admission-requests"),Map.of("requestNumber","FORBIDDEN","patientId",patient,
            "serviceId",other.service(),"priority",1,"origin","EMERGENCY"),404);
        assertThat(count("encounters")).isZero();
        assertThat(getJson("/api/admission-requests/"+request).path("status").asString()).isEqualTo("WAITING");
    }

    @Test
    void revocationImmediatelyChangesRestVisibility() throws Exception {
        UUID assignment=grant("unit-user","UNIT",onlyId("healthcare_units"));
        var user=manager("unit-user","MANAGER");
        as(user,get("/api/beds"),null,200);
        call(delete("/api/access/grants/"+assignment),null,204);
        as(user,get("/api/beds"),null,403);
        assertThat(as(user,get("/api/access/me"),null,200).path("scopes").size()).isZero();
    }

    @Test
    void websocketRequiresValidOneUseTicketAndAllowedOrigin() throws Exception {
        assertThatThrownBy(()->socket("missing","http://localhost:5173")).isInstanceOf(ExecutionException.class);
        String ticket=ticket(admin());
        try(var client=socket(ticket,"http://localhost:5173")) {
            assertThat(next(client).path("type").asString()).isEqualTo("RESYNC_REQUIRED");
            assertThatThrownBy(()->socket(ticket,"http://localhost:5173")).isInstanceOf(ExecutionException.class);
        }
        String wrongOrigin=ticket(admin());
        assertThatThrownBy(()->socket(wrongOrigin,"http://untrusted.example")).isInstanceOf(ExecutionException.class);
    }

    @Test
    void websocketDeliversOnlyEventsInCurrentScope() throws Exception {
        UUID service=onlyId("clinical_services");
        var other=topology(onlyId("uls"),null,"OTHER");
        grant("service-user","SERVICE",service);
        try(var client=socket(ticket(manager("service-user","MANAGER")),"http://localhost:5173")) {
            next(client);
            call(put("/api/beds/"+other.bed()+"/status"),Map.of("version",0,"status","BLOCKED","reason","Outside"),200);
            UUID local=bedId("Bed MAC");
            call(put("/api/beds/"+local+"/status"),Map.of("version",0,"status","BLOCKED","reason","Inside"),200);
            var event=next(client);
            assertThat(event.path("type").asString()).isEqualTo("BED_STATUS_CHANGED");
            assertThat(event.path("resourceId").asString()).isEqualTo(local.toString());
            assertThat(event.has("scopes")).isFalse();
            assertThat(client.frames.poll(250,TimeUnit.MILLISECONDS)).isNull();
        }
    }

    @Test
    void rollbackAndEquivalentReplaysDoNotBroadcastEvents() throws Exception {
        try(var client=socket(ticket(admin()),"http://localhost:5173")) {
            next(client);
            var previous=SecurityContextHolder.getContext();
            var context=SecurityContextHolder.createEmptyContext();
            context.setAuthentication(new JwtAuthenticationToken(Jwt.withTokenValue("test").header("alg","none")
                .subject("admin-sub").expiresAt(Instant.now().plusSeconds(300)).build(),List.of(new SimpleGrantedAuthority("ROLE_ADMIN"))));
            SecurityContextHolder.setContext(context);
            try {
                new TransactionTemplate(transactions).executeWithoutResult(tx->{
                    operations.changeBedState(bedId("Bed MAC"),new BedState(BedStatus.BLOCKED,0L,"Rolled back"));
                    tx.setRollbackOnly();
                });
            } finally { SecurityContextHolder.setContext(previous); }
            assertThat(bedStatus()).isEqualTo(BedStatus.AVAILABLE);
            assertThat(client.frames.poll(250,TimeUnit.MILLISECONDS)).isNull();
            send(example("admission.json"),204);
            assertThat(next(client).path("type").asString()).isEqualTo("PATIENT_ADMITTED");
            send(example("admission.json"),204);
            assertThat(client.frames.poll(250,TimeUnit.MILLISECONDS)).isNull();
            send(example("discharge.json"),204);
            assertThat(next(client).path("type").asString()).isEqualTo("PATIENT_DISCHARGED");
            send(example("discharge.json"),204);
            assertThat(client.frames.poll(250,TimeUnit.MILLISECONDS)).isNull();
        }
    }

    @Test
    void revokedScopeClosesExistingSocketAndInvalidatesUnusedTicket() throws Exception {
        UUID assignment=grant("unit-user","UNIT",onlyId("healthcare_units"));
        var user=manager("unit-user","MANAGER");
        String unused=ticket(user);
        try(var client=socket(ticket(user),"http://localhost:5173")) {
            next(client);
            call(delete("/api/access/grants/"+assignment),null,204);
            assertThat(client.closed.get(5,TimeUnit.SECONDS)).isEqualTo(1008);
            assertThatThrownBy(()->socket(unused,"http://localhost:5173")).isInstanceOf(ExecutionException.class);
        }
    }

    @Test
    void socketExpiresWithJwtAndReconnectRequestsFreshSnapshot() throws Exception {
        var shortToken=jwt().jwt(j->j.subject("admin-sub").expiresAt(Instant.now().plusSeconds(3)))
            .authorities(new SimpleGrantedAuthority("ROLE_ADMIN"));
        try(var client=socket(ticket(shortToken),"http://localhost:5173")) {
            assertThat(next(client).path("type").asString()).isEqualTo("RESYNC_REQUIRED");
            assertThat(client.closed.get(6,TimeUnit.SECONDS)).isEqualTo(1008);
        }
        try(var reconnected=socket(ticket(admin()),"http://localhost:5173")) {
            assertThat(next(reconnected).path("type").asString()).isEqualTo("RESYNC_REQUIRED");
        }
    }

    private record Topology(UUID unit,UUID service,UUID ward,UUID bed) { }
    private Topology topology(UUID uls,UUID existingUnit,String prefix) throws Exception {
        UUID unit=existingUnit==null ? id(node("UNIT",prefix+" Unit",null,uls,null)) : existingUnit;
        UUID building=id(node("BUILDING",prefix+" Building",null,unit,null));
        UUID floor=id(node("FLOOR",prefix+" Floor",null,building,null));
        UUID wing=id(node("WING",prefix+" Wing",null,floor,null));
        UUID service=id(node("SERVICE",prefix+" Service",prefix,unit,null));
        UUID ward=id(node("WARD",prefix+" Ward","Ward "+prefix,wing,service));
        UUID room=id(node("ROOM",null,"Room "+prefix,ward,null));
        UUID bed=id(node("BED",null,"Bed "+prefix,room,null));
        return new Topology(unit,service,ward,bed);
    }
    private String at(String fhir,String prefix) {
        return fhir.replace("Ward 30004, Room 7005, Bed MAC","Ward "+prefix+", Room "+prefix+", Bed "+prefix);
    }
    private UUID grant(String subject,String type,UUID scope) throws Exception {
        return id(call(post("/api/access/grants"),Map.of("subject",subject,"type",type,"scopeId",scope),201));
    }
    private JwtRequestPostProcessor manager(String subject,String role) {
        List<String> groups=database.query("SELECT scope_type,COALESCE(uls_id,unit_id,service_id) AS scope_id "
            +"FROM user_scope_grants WHERE keycloak_subject=?",(r,n)->"/"+r.getString("scope_type")+"_Assigned__"
                +r.getObject("scope_id",UUID.class),subject);
        String authority=role.equals("ROLE_USER") ? role : "MANAGER";
        return jwt().jwt(j->j.subject(subject).expiresAt(Instant.now().plusSeconds(300)).claim("groups",groups))
            .authorities(new SimpleGrantedAuthority(authority));
    }
    private JsonNode as(JwtRequestPostProcessor user,MockHttpServletRequestBuilder request,Object body,int status) throws Exception {
        if(body!=null) request.content(json.writeValueAsString(body));
        String result=mvc.perform(request.with(user).contentType(MediaType.APPLICATION_JSON)).andExpect(status().is(status))
            .andReturn().getResponse().getContentAsString();
        return result.isBlank() ? json.nullNode() : json.readTree(result);
    }
    private String ticket(JwtRequestPostProcessor user) throws Exception {
        return as(user,post("/api/events/tickets"),null,200).path("ticket").asString();
    }
    private static final HttpClient WS_HTTP=HttpClient.newHttpClient();
    private WsClient socket(String ticket,String origin) throws Exception {
        var listener=new WsClient();
        listener.ws=WS_HTTP.newWebSocketBuilder().header("Origin",origin)
            .buildAsync(URI.create("ws://localhost:"+port+"/ws/events?ticket="+ticket),listener).get(5,TimeUnit.SECONDS);
        return listener;
    }
    private JsonNode next(WsClient client) throws Exception {
        String value=client.frames.poll(5,TimeUnit.SECONDS);
        assertThat(value).as("websocket frame").isNotNull();
        return json.readTree(value);
    }
    private static class WsClient implements WebSocket.Listener,AutoCloseable {
        final BlockingQueue<String> frames=new LinkedBlockingQueue<>();
        final CompletableFuture<Integer> closed=new CompletableFuture<>();
        final StringBuilder buffer=new StringBuilder();
        WebSocket ws;
        @Override public void onOpen(WebSocket socket) { socket.request(1); }
        @Override public CompletionStage<?> onText(WebSocket socket,CharSequence value,boolean last) {
            buffer.append(value);
            if(last) { frames.add(buffer.toString()); buffer.setLength(0); }
            socket.request(1); return CompletableFuture.completedFuture(null);
        }
        @Override public CompletionStage<?> onClose(WebSocket socket,int code,String reason) {
            closed.complete(code); return CompletableFuture.completedFuture(null);
        }
        @Override public void onError(WebSocket socket,Throwable error) { closed.completeExceptionally(error); }
        @Override public void close() { if(ws!=null) ws.abort(); }
    }

    @Test
    void analyticsSeparateCurrentCapacityFromPeriodMetricsAndExcludeFutureAppointmentsFromWait() throws Exception {
        analyticsFixture();
        var metrics=getJson("/api/analytics/indicators?from=2026-10-20T00:00:00Z&to=2026-10-25T12:00:00Z");
        assertThat(metrics.path("asOf").asString()).isEqualTo("2026-10-25T12:00:00Z");
        assertThat(metrics.path("beds").path("total").asInt()).isEqualTo(4);
        assertThat(metrics.path("beds").path("capacity").asInt()).isEqualTo(3);
        assertThat(metrics.path("beds").path("occupancyPercent").asDouble()).isEqualTo(33.33);
        var stays=metrics.path("stays");
        assertThat(stays.path("active").asInt()).isEqualTo(1);
        assertThat(stays.path("admissionsInPeriod").asInt()).isEqualTo(1);
        assertThat(stays.path("dischargesInPeriod").asInt()).isEqualTo(2);
        assertThat(stays.path("lengthOfStaySamples").asInt()).isEqualTo(1);
        assertThat(stays.path("averageLengthOfStayDays").asDouble()).isEqualTo(4.5);
        assertThat(stays.path("dischargeDelaySamples").asInt()).isEqualTo(1);
        assertThat(stays.path("averageClinicalAdministrativeHours").asDouble()).isEqualTo(2);
        assertThat(stays.path("prolongedActiveStays").asInt()).isEqualTo(1);
        assertThat(stays.path("oldestClinicalPendingHours").asDouble()).isEqualTo(9);
        assertThat(stays.path("overdueExpectedDischarges").asInt()).isEqualTo(1);
        var waiting=metrics.path("waiting");
        assertThat(waiting.path("pending").asInt()).isEqualTo(3);
        assertThat(waiting.path("dueNow").asInt()).isEqualTo(2);
        assertThat(waiting.path("emergencyDueNow").asInt()).isEqualTo(1);
        assertThat(waiting.path("overdue").asInt()).isEqualTo(1);
        assertThat(waiting.path("averageWaitingHours").asDouble()).isEqualTo(8);
        assertThat(waiting.path("oldestWaitingHours").asDouble()).isEqualTo(14);
    }

    @Test
    void alertsExplainThresholdsAndOperationalCauses() throws Exception {
        analyticsFixture();
        var result=getJson("/api/analytics/alerts");
        Map<String,JsonNode> alerts=new HashMap<>(); result.path("alerts").values().forEach(a->alerts.put(a.path("code").asString(),a));
        assertThat(alerts.keySet()).contains("WAITING_TIME","PROLONGED_STAYS","CLINICAL_DISCHARGE_DELAY","OVERDUE_DISCHARGE_PLAN");
        assertThat(alerts.keySet()).doesNotContain("OCCUPANCY_PRESSURE");
        assertThat(alerts.get("WAITING_TIME").path("severity").asString()).isEqualTo("CRITICAL");
        assertThat(alerts.get("WAITING_TIME").path("observed").asDouble()).isEqualTo(14);
        assertThat(alerts.get("PROLONGED_STAYS").path("observed").asDouble()).isEqualTo(24);
        assertThat(result.path("thresholds").path("longStayDays").asInt()).isEqualTo(14);
    }

    @Test
    void emptyScopeHasNullRatesAndNoInventedHistoryAndInvalidPeriodsAreRejected() throws Exception {
        var metrics=getJson("/api/analytics/indicators?serviceId="+UUID.randomUUID());
        assertThat(metrics.path("beds").path("total").asInt()).isZero();
        assertThat(metrics.path("beds").path("occupancyPercent").isNull()).isTrue();
        assertThat(metrics.path("stays").path("averageLengthOfStayDays").isNull()).isTrue();
        assertThat(metrics.path("waiting").path("oldestWaitingHours").isNull()).isTrue();
        for(String query:List.of("from=2026-10-26T00:00:00Z","from=2026-10-25T12:00:00Z&to=2026-10-25T12:00:00Z",
                "from=2020-01-01T00:00:00Z","wardId="+onlyId("wards"))) {
            call(get("/api/analytics/indicators?"+query),null,400);
        }
        for(String uri:List.of("/api/analytics/indicators","/api/analytics/alerts","/api/analytics/occupancy-forecast")) {
            mvc.perform(get(uri)).andExpect(status().isUnauthorized());
            as(manager("unassigned","MANAGER"),get(uri),null,403);
        }
    }

    @Test
    void analyticAggregatesAndForecastPagesCannotRevealOtherServices() throws Exception {
        UUID service=onlyId("clinical_services");
        var other=topology(onlyId("uls"),null,"OUTSIDE");
        send(at(example("admission.json"),"OUTSIDE"),204);
        grant("analyst","SERVICE",service);
        var user=manager("analyst","MANAGER");
        assertThat(as(user,get("/api/analytics/indicators"),null,200).path("beds").path("total").asInt()).isEqualTo(2);
        assertThat(as(user,get("/api/analytics/indicators"),null,200).path("stays").path("active").asInt()).isZero();
        assertThat(as(user,get("/api/analytics/indicators?serviceId="+other.service()),null,200).path("beds").path("total").asInt()).isZero();
        var occupancy=as(user,get("/api/analytics/occupancy"),null,200);
        assertThat(occupancy.path("wings").size()).isEqualTo(1);
        assertThat(occupancy.path("units").size()).isZero();
        assertThat(occupancy.path("wings").path(0).path("capacity").asInt()).isEqualTo(2);
        assertThat(occupancy.path("wings").path(0).path("occupied").asInt()).isZero();
        var forecast=as(user,get("/api/analytics/occupancy-forecast"),null,200);
        assertThat(forecast.path("services").path("totalElements").asInt()).isEqualTo(1);
        assertThat(forecast.path("services").path("content").path(0).path("input").path("serviceId").asString()).isEqualTo(service.toString());
        assertThat(forecast.path("services").path("content").path(0).path("historyQuality").asString()).isEqualTo("NO_OBSERVED_HISTORY");
    }

    @Test
    void bedSuggestionsFilterServiceStatusAndRespectPreferredWardAndRequestScope() throws Exception {
        UUID service=onlyId("clinical_services");
        UUID request=waitingRequest();
        UUID unit=onlyId("healthcare_units");
        UUID wing=onlyId("wings");
        UUID preferred=id(node("WARD","Preferred","Ward Preferred",wing,service));
        UUID room=id(node("ROOM",null,"Room Preferred",preferred,null));
        UUID preferredBed=id(node("BED",null,"Bed Preferred",room,null));
        var foreign=topology(onlyId("uls"),null,"FOREIGN");
        setBed("Bed MAD","CLEANING");
        var suggestions=getJson("/api/admission-requests/"+request+"/bed-suggestions?preferredWardId="+preferred);
        assertThat(suggestions.path("candidateCount").asInt()).isEqualTo(2);
        assertThat(suggestions.path("recommendations").path(0).path("bedId").asString()).isEqualTo(preferredBed.toString());
        assertThat(suggestions.path("recommendations").path(0).path("score").asInt()).isEqualTo(120);
        assertThat(suggestions.path("engine").path("source").asString()).isEqualTo("BACKEND_BASELINE");
        assertThat(suggestions.path("engine").path("degraded").asBoolean()).isTrue();
        assertThat(count("encounters")).isZero(); // A suggestion never reserves or admits.
        call(get("/api/admission-requests/"+request+"/bed-suggestions?preferredWardId="+foreign.ward()),null,400);
        call(get("/api/admission-requests/"+request+"/bed-suggestions?limit=21"),null,400);
        grant("foreign-manager","UNIT",foreign.unit());
        as(manager("foreign-manager","MANAGER"),get("/api/admission-requests/"+request+"/bed-suggestions"),null,404);
        assertThat(getJson("/api/hierarchy/UNIT/"+unit).path("id").asString()).isEqualTo(unit.toString());
    }

    @Test
    void suggestionsRejectClosedRequestsAndExplainAnAlreadyAdmittedPatient() throws Exception {
        UUID request=waitingRequest();
        String payload=example("admission.json").replace("999999999","QUEUE-SNS");
        send(payload,204);
        var result=getJson("/api/admission-requests/"+request+"/bed-suggestions");
        assertThat(result.path("eligible").asBoolean()).isFalse();
        assertThat(result.path("ineligibleReason").asString()).isEqualTo("ACTIVE_ENCOUNTER");
        assertThat(result.path("recommendations").size()).isZero();
        call(post("/api/admission-requests/"+request+"/cancel"),Map.of("version",0),200);
        call(get("/api/admission-requests/"+request+"/bed-suggestions"),null,409);
    }

    @Test
    void forecastsReportKnownDemandAndHistoryWithoutDependingOnAlgorithmsAvailability() throws Exception {
        analyticsFixture();
        var forecast=getJson("/api/analytics/occupancy-forecast?size=1");
        assertThat(forecast.path("historyDays").asInt()).isEqualTo(14);
        assertThat(forecast.path("engine").path("degraded").asBoolean()).isTrue();
        var row=forecast.path("services").path("content").path(0);
        assertThat(row.path("input").path("knownAdmissions24h").asInt()).isEqualTo(3);
        assertThat(row.path("input").path("historicalUnscheduledAdmissions").asInt()).isEqualTo(1);
        assertThat(row.path("input").path("historicalDischarges").asInt()).isEqualTo(3);
        assertThat(row.path("input").path("plannedDischarges24h").asInt()).isZero();
        assertThat(row.path("horizons").path(0).path("hours").asInt()).isEqualTo(24);
        assertThat(row.path("horizons").path(1).path("hours").asInt()).isEqualTo(48);
        assertThat(row.path("horizons").path(0).path("projectedOccupied").asDouble()).isLessThanOrEqualTo(3);
        // The outage affects only engine metadata, never basic operations or persisted data.
        assertThat(getJson("/api/beds").path("totalElements").asInt()).isEqualTo(4);
        assertThat(count("admission_requests")).isEqualTo(3);
    }

    private UUID analyticsFixture() throws Exception {
        UUID service=onlyId("clinical_services"),room=onlyId("rooms");
        UUID blocked=id(node("BED",null,"ANALYTICS-BLOCKED",room,null));
        UUID cleaning=id(node("BED",null,"ANALYTICS-CLEANING",room,null));
        database.update("UPDATE beds SET status='BLOCKED' WHERE id=?",blocked);
        database.update("UPDATE beds SET status='CLEANING' WHERE id=?",cleaning);
        UUID active=analyticStay(service,"ACTIVE","IN_PROGRESS","2026-10-01T12:00:00Z",null,"2026-10-25T03:00:00Z","2026-10-24T12:00:00Z");
        database.update("UPDATE beds SET status='OCCUPIED' WHERE code='Bed MAC'");
        database.update("INSERT INTO location_allocations(id,encounter_id,bed_id,assigned_at) VALUES(?,?,?,?)",UUID.randomUUID(),active,
            bedId("Bed MAC"),timestamp("2026-10-01T12:00:00Z"));
        analyticStay(service,"CLOSED","FINISHED","2026-10-20T00:00:00Z","2026-10-24T12:00:00Z","2026-10-24T10:00:00Z",null);
        analyticStay(service,"OLD","FINISHED","2026-10-10T00:00:00Z","2026-10-19T12:00:00Z",null,null);
        analyticStay(service,"NO-START","FINISHED",null,"2026-10-23T12:00:00Z",null,null);
        analyticRequest(service,"EMERGENCY",1,"2026-10-24T22:00:00Z",null);
        analyticRequest(service,"SCHEDULED",3,"2026-10-23T00:00:00Z","2026-10-26T10:00:00Z");
        analyticRequest(service,"SURGICAL",2,"2026-10-24T00:00:00Z","2026-10-25T10:00:00Z");
        return active;
    }
    private UUID analyticStay(UUID service,String key,String state,String start,String end,String clinical,String expected) {
        UUID patient=UUID.randomUUID(),encounter=UUID.randomUUID();
        database.update("INSERT INTO patients(id,sns_number,full_name) VALUES(?,?,?)",patient,"AN-"+key,"Synthetic "+key);
        database.update("INSERT INTO encounters(id,visit_number,patient_id,status,start_period,end_period,clinical_discharge_at,expected_discharge_at,service_id)"
            +" VALUES(?,?,?,?,?,?,?,?,?)",encounter,"AN-"+key,patient,state,timestamp(start),timestamp(end),timestamp(clinical),timestamp(expected),service);
        return encounter;
    }
    private void analyticRequest(UUID service,String origin,int priority,String requested,String desired) {
        UUID patient=UUID.randomUUID();
        database.update("INSERT INTO patients(id,sns_number,full_name) VALUES(?,?,?)",patient,"AN-"+origin,"Synthetic "+origin);
        database.update("INSERT INTO admission_requests(id,request_number,patient_id,service_id,origin,priority,requested_at,desired_admission_at,status)"
            +" VALUES(?,?,?,?,?,?,?,?, 'WAITING')",UUID.randomUUID(),"AN-"+origin,patient,service,origin,priority,timestamp(requested),timestamp(desired));
    }
    private java.sql.Timestamp timestamp(String value) { return value==null?null:java.sql.Timestamp.from(Instant.parse(value)); }

    private static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor admin() {
        return jwt().jwt(j->j.subject("admin-sub").expiresAt(Instant.now().plusSeconds(300)))
            .authorities(new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_ADMIN"));
    }
    private UUID bedId(String code) { return database.queryForObject("SELECT id FROM beds WHERE code=?", UUID.class, code); }
    private UUID onlyId(String table) { return onlyId(table, "true"); }
    private UUID onlyId(String table, String where) { return database.queryForObject("SELECT id FROM " + table + " WHERE " + where, UUID.class); }
    private UUID id(JsonNode node) { return UUID.fromString(node.path("id").asString()); }
    private JsonNode getJson(String uri) throws Exception { return call(get(uri), null, 200); }
    private JsonNode call(MockHttpServletRequestBuilder builder, Object body, int expected) throws Exception {
        if (body != null) builder.content(json.writeValueAsString(body));
        var result = mvc.perform(builder.with(admin()).contentType(MediaType.APPLICATION_JSON)).andExpect(status().is(expected))
            .andReturn().getResponse().getContentAsString();
        return result.isBlank() ? json.nullNode() : json.readTree(result);
    }
    private MockHttpServletRequestBuilder fhir(String body) { return post("/api/fhir/bundles").content(body); }
    private JsonNode node(String type, String name, String code, UUID parent, UUID service) throws Exception {
        Map<String, Object> input = new HashMap<>();
        if (name != null) input.put("name", name);
        if (code != null) input.put("code", code);
        if (parent != null) input.put("parentId", parent);
        if (service != null) input.put("serviceId", service);
        return call(post("/api/hierarchy/" + type), input, 201);
    }
    private void setBed(String code, String state) throws Exception {
        UUID id = bedId(code);
        long version = getJson("/api/beds/" + id).path("version").asLong();
        call(put("/api/beds/" + id + "/status"), Map.of("status", state, "version", version), 200);
    }
    @FunctionalInterface interface Request { MockHttpServletRequestBuilder build() throws Exception; }
    private List<Integer> race(Request first, Request second) throws Exception {
        CyclicBarrier barrier = new CyclicBarrier(2);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var results = new ArrayList<Future<Integer>>();
            for (Request request : List.of(first, second)) results.add(pool.submit(() -> {
                barrier.await(10, TimeUnit.SECONDS);
                return mvc.perform(request.build().with(admin()).contentType(MediaType.APPLICATION_JSON))
                    .andReturn().getResponse().getStatus();
            }));
            return List.of(results.get(0).get(20, TimeUnit.SECONDS), results.get(1).get(20, TimeUnit.SECONDS));
        }
    }
}
