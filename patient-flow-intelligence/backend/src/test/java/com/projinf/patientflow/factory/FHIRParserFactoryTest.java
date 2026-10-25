package com.projinf.patientflow.factory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

import com.projinf.patientflow.domain.model.EncounterStatus;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Objects;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

class FHIRParserFactoryTest {
    private final JsonMapper json = JsonMapper.builder().build();
    private final FHIRParserFactory parser = new FHIRParserFactory(
        "https://www.sns.gov.pt/numero-utente", "urn:hospital:process-number", "urn:hospital:visit-number");

    @ParameterizedTest
    @ValueSource(strings = {"admission.json", "discharge.json", "admission-locations.json", "discharge-locations.json"})
    void acceptsBothHospitalLayouts(String file) throws IOException {
        var parsed = parser.parse(example(file));
        boolean locations = file.contains("locations");
        assertThat(parsed.patient().getSnsNumber()).isEqualTo(locations ? "123456789" : "999999999");
        assertThat(parsed.patient().getHospitalNumber()).isEqualTo(locations ? "P-001" : "99999");
        assertThat(parsed.encounter().getVisitNumber()).isEqualTo(locations ? "V-2026-0001" : "99000999");
        assertThat(parsed.encounter().getStatus()).isEqualTo(file.startsWith("admission")
            ? EncounterStatus.IN_PROGRESS : EncounterStatus.FINISHED);
        assertThat(parsed.encounter().getStartPeriod()).isEqualTo(
            Instant.parse(locations ? "2026-10-20T10:00:00Z" : "2019-01-18T15:04:00Z"));
        assertThat(parsed.location().wardCode()).isEqualTo("Ward 30004");
        assertThat(parsed.location().roomCode()).isEqualTo("Room 7005");
        assertThat(parsed.location().bedCode()).isEqualTo("Bed MAC");
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "[]", "{}", "{\"resourceType\":\"Patient\"}",
        "{\"resourceType\":\"Bundle\",\"entry\":[]}", "{\"resourceType\":\"Bundle\",\"entry\":{}}"})
    void rejectsInvalidEnvelope(String body) {
        assertThatIllegalArgumentException().isThrownBy(() -> parser.parse(json.readTree(body)));
    }

    @Test
    void acceptsConfiguredIdentifierSystems() throws IOException {
        String body = example("admission-locations.json").toString()
            .replace("https://www.sns.gov.pt/numero-utente", "urn:custom:sns")
            .replace("urn:hospital:process-number", "urn:custom:record")
            .replace("urn:hospital:visit-number", "urn:custom:visit");
        var custom = new FHIRParserFactory("urn:custom:sns", "urn:custom:record", "urn:custom:visit");
        assertThat(custom.parse(json.readTree(body)).encounter().getVisitNumber()).isEqualTo("V-2026-0001");
    }

    @Test
    void acceptsIdentifierTypesWithoutKnownSystemsAndResolvesFullUrlSubject() throws IOException {
        ObjectNode bundle = example("admission.json");
        for (JsonNode identifier : resource(bundle, 0).path("identifier").values()) {
            ((ObjectNode) identifier).put("system", "urn:other");
        }
        resource(bundle, 1).withObject("subject").put("reference", bundle.path("entry").path(0).path("fullUrl").asString());
        assertThat(parser.parse(bundle).patient().getSnsNumber()).isEqualTo("999999999");
    }

    @Test
    void fallsBackToEncounterIdAndLocationNames() throws IOException {
        ObjectNode bundle = example("admission-locations.json");
        resource(bundle, 1).remove("identifier");
        resource(bundle, 1).put("id", "visit-fallback");
        assertThat(parser.parse(bundle).encounter().getVisitNumber()).isEqualTo("visit-fallback");
    }

    @Test
    void acceptsLocationIdentifiersAndNormalizesTimeZones() throws IOException {
        ObjectNode bundle = example("admission-locations.json");
        resource(bundle, 2).putArray("identifier").addObject().put("value", "WARD-CODE");
        resource(bundle, 1).withObject("period").put("start", "2026-10-20T11:00:00+01:00");
        var parsed = parser.parse(bundle);
        assertThat(parsed.location().wardCode()).isEqualTo("WARD-CODE");
        assertThat(parsed.encounter().getStartPeriod()).isEqualTo(Instant.parse("2026-10-20T10:00:00Z"));
    }

    @Test
    void rejectsMultiplePatientsOrEncounters() throws IOException {
        for (int index : new int[]{0, 1}) {
            ObjectNode bundle = example("admission.json");
            ((ArrayNode) bundle.path("entry")).add(bundle.path("entry").path(index).deepCopy());
            assertThatIllegalArgumentException().isThrownBy(() -> parser.parse(bundle)).withMessageContaining("exatamente um");
        }
    }

    @Test
    void rejectsMismatchedPatientReference() throws IOException {
        ObjectNode bundle = example("admission.json");
        resource(bundle, 1).withObject("subject").put("reference", "Patient/someone-else");
        assertThatIllegalArgumentException().isThrownBy(() -> parser.parse(bundle)).withMessageContaining("subject");
    }

    @Test
    void rejectsContradictoryIdentifiers() throws IOException {
        ObjectNode bundle = example("admission.json");
        resource(bundle, 0).withArray("identifier").addObject()
            .put("system", "urn:id:HAS").put("value", "DIFFERENT-SNS");
        assertThatIllegalArgumentException().isThrownBy(() -> parser.parse(bundle)).withMessageContaining("contraditórios");
    }

    @Test
    void rejectsMissingSnsAndBlankName() throws IOException {
        ObjectNode noSns = example("admission.json");
        resource(noSns, 0).remove("identifier");
        assertThatIllegalArgumentException().isThrownBy(() -> parser.parse(noSns)).withMessageContaining("SNS");
        ObjectNode noName = example("admission.json");
        resource(noName, 0).putArray("name").addObject().put("text", " ");
        assertThatIllegalArgumentException().isThrownBy(() -> parser.parse(noName)).withMessageContaining("nome");
    }

    @ParameterizedTest
    @ValueSource(strings = {"1950", "1950-04", "2026-02-30"})
    void rejectsPartialOrInvalidBirthDates(String date) throws IOException {
        ObjectNode bundle = example("admission.json");
        resource(bundle, 0).put("birthDate", date);
        assertThatIllegalArgumentException().isThrownBy(() -> parser.parse(bundle)).withMessageContaining("birthDate");
    }

    @Test
    void rejectsUnsupportedStatusAndNumericIdentifiers() throws IOException {
        ObjectNode bundle = example("admission.json");
        resource(bundle, 1).put("status", "cancelled");
        assertThatIllegalArgumentException().isThrownBy(() -> parser.parse(bundle)).withMessageContaining("suportado");
        ObjectNode numeric = example("admission.json");
        ((ObjectNode) resource(numeric, 0).path("identifier").path(1)).put("value", 123);
        assertThatIllegalArgumentException().isThrownBy(() -> parser.parse(numeric)).withMessageContaining("texto");
    }

    @Test
    void rejectsMissingAmbiguousOrConflictingLocations() throws IOException {
        ObjectNode missing = example("admission.json");
        resource(missing, 1).remove("location");
        assertThatIllegalArgumentException().isThrownBy(() -> parser.parse(missing)).withMessageContaining("localização");
        ObjectNode ambiguous = example("admission-locations.json");
        ambiguous.withArray("entry").add(ambiguous.path("entry").path(4).deepCopy());
        assertThatIllegalArgumentException().isThrownBy(() -> parser.parse(ambiguous)).withMessageContaining("ambígua");
        ObjectNode conflicting = example("admission-locations.json");
        resource(conflicting, 1).putArray("location").addObject().putObject("location")
            .put("display", "Ward 30004, Room 7005, Bed OTHER");
        assertThatIllegalArgumentException().isThrownBy(() -> parser.parse(conflicting)).withMessageContaining("contraditórios");
    }

    @Test
    void rejectsInvalidPeriods() throws IOException {
        ObjectNode withoutOffset = example("admission.json");
        resource(withoutOffset, 1).withObject("actualPeriod").put("start", "2026-10-20T10:00:00");
        assertThatIllegalArgumentException().isThrownBy(() -> parser.parse(withoutOffset)).withMessageContaining("fuso");
        ObjectNode contradictory = example("admission.json");
        resource(contradictory, 1).putObject("period").put("start", "2026-10-20T10:00:00Z");
        assertThatIllegalArgumentException().isThrownBy(() -> parser.parse(contradictory)).withMessageContaining("contraditórios");
        ObjectNode reversed = example("discharge-locations.json");
        resource(reversed, 1).withObject("period").put("end", "2026-10-19T10:00:00Z");
        assertThatIllegalArgumentException().isThrownBy(() -> parser.parse(reversed)).withMessageContaining("anteceder");
        ObjectNode admissionWithEnd = example("admission.json");
        resource(admissionWithEnd, 1).withObject("actualPeriod").put("end", "2026-10-25T10:00:00Z");
        assertThatIllegalArgumentException().isThrownBy(() -> parser.parse(admissionWithEnd)).withMessageContaining("data de fim");
    }

    private ObjectNode example(String file) throws IOException {
        try (var input = Objects.requireNonNull(getClass().getResourceAsStream("/fhir/" + file))) {
            return (ObjectNode) json.readTree(new String(input.readAllBytes(), StandardCharsets.UTF_8));
        }
    }

    private ObjectNode resource(JsonNode bundle, int index) {
        return (ObjectNode) bundle.path("entry").path(index).path("resource");
    }
}
