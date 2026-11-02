package com.projinf.patientflow.factory;

import com.projinf.patientflow.domain.model.Encounter;
import com.projinf.patientflow.domain.model.EncounterStatus;
import com.projinf.patientflow.domain.model.Patient;
import com.projinf.patientflow.dto.ParsedBundleDTO;
import com.projinf.patientflow.dto.ParsedLocationDTO;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/** Parser for the two supported hospital bundle layouts; this is not a full FHIR validator. */
@Component
public class FHIRParserFactory {

    private static final String IDENTIFIER_TYPES = "http://terminology.hl7.org/CodeSystem/v2-0203";
    private static final Pattern DISPLAY = Pattern.compile(
        "^(Ward\\s+[^,]+),\\s*(Room\\s+[^,]+),\\s*(Bed\\s+[^,]+)$");

    private final String snsSystem;
    private final String hospitalSystem;
    private final String visitSystem;

    public FHIRParserFactory(
            @Value("${fhir.systems.sns:https://www.sns.gov.pt/numero-utente}") String snsSystem,
            @Value("${fhir.systems.hospital-number:urn:hospital:process-number}") String hospitalSystem,
            @Value("${fhir.systems.visit-number:urn:hospital:visit-number}") String visitSystem) {
        this.snsSystem = snsSystem;
        this.hospitalSystem = hospitalSystem;
        this.visitSystem = visitSystem;
    }

    public ParsedBundleDTO parse(JsonNode bundle) {
        if (bundle == null || !bundle.isObject() || !"Bundle".equals(text(bundle, "resourceType"))) {
            throw invalid("O corpo deve ser um recurso Bundle FHIR");
        }
        if (!bundle.path("entry").isArray() || bundle.path("entry").isEmpty()) {
            throw invalid("Bundle.entry deve ser uma lista não vazia");
        }
        List<JsonNode> patients = new ArrayList<>();
        List<JsonNode> encounters = new ArrayList<>();
        List<JsonNode> locations = new ArrayList<>();
        JsonNode patientEntry = null;
        for (JsonNode entry : bundle.path("entry").values()) {
            JsonNode resource = entry.path("resource");
            if (!resource.isObject() || text(resource, "resourceType") == null) {
                throw invalid("Cada entrada deve conter um recurso com resourceType");
            }
            switch (text(resource, "resourceType")) {
                case "Patient" -> { patients.add(resource); patientEntry = entry; }
                case "Encounter" -> encounters.add(resource);
                case "Location" -> locations.add(resource);
                default -> { /* Other resources do not participate in this ingestion contract. */ }
            }
        }
        if (patients.size() != 1 || encounters.size() != 1) {
            throw invalid("O Bundle deve conter exatamente um Patient e um Encounter");
        }
        JsonNode patientResource = patients.getFirst();
        JsonNode encounterResource = encounters.getFirst();
        validateSubject(patientResource, patientEntry, encounterResource);
        return new ParsedBundleDTO(patient(patientResource), encounter(encounterResource),
            location(locations, encounterResource));
    }

    private Patient patient(JsonNode resource) {
        Patient patient = new Patient();
        patient.setSnsNumber(required(identifier(resource, snsSystem, "urn:id:HAS", "SB", "SNS"),
            "Patient sem número SNS"));
        patient.setHospitalNumber(identifier(resource, hospitalSystem, "urn:id:HOS", "MR", "NS"));
        JsonNode names = resource.path("name");
        if (!names.isArray() || names.isEmpty()) throw invalid("Patient sem nome");
        JsonNode name = names.get(0);
        for (JsonNode candidate : names.values()) {
            if ("official".equals(text(candidate, "use"))) { name = candidate; break; }
        }
        String fullName = text(name, "text");
        if (fullName == null) {
            List<String> parts = new ArrayList<>();
            JsonNode given = name.path("given");
            if (!given.isMissingNode() && !given.isArray()) throw invalid("Patient.name.given deve ser uma lista");
            for (JsonNode part : given.values()) {
                if (!part.isString() || part.asString().isBlank()) throw invalid("Nome próprio inválido");
                parts.add(part.asString().trim());
            }
            String family = text(name, "family");
            if (family != null) parts.add(family);
            fullName = String.join(" ", parts);
        }
        patient.setFullName(required(length(fullName), "Patient sem nome"));
        String birthDate = text(resource, "birthDate");
        try {
            patient.setBirthDate(birthDate == null ? null : LocalDate.parse(birthDate));
        } catch (DateTimeParseException ex) {
            throw invalid("Patient.birthDate deve usar YYYY-MM-DD");
        }
        String gender = text(resource, "gender");
        if (gender != null && !Set.of("male", "female", "other", "unknown").contains(gender)) {
            throw invalid("Patient.gender inválido");
        }
        patient.setGender(gender == null ? "unknown" : gender);
        return patient;
    }

    private Encounter encounter(JsonNode resource) {
        Encounter encounter = new Encounter();
        String visit = identifier(resource, visitSystem, null, "VN", null);
        encounter.setVisitNumber(required(visit == null ? text(resource, "id") : visit,
            "Encounter sem número de visita ou id"));
        encounter.setStatus(EncounterStatus.fromFhirCode(text(resource, "status")));
        validateObject(resource, "period");
        validateObject(resource, "actualPeriod");
        Instant start = periodValue(resource, "start");
        Instant end = periodValue(resource, "end");
        if (start != null && end != null && end.isBefore(start)) {
            throw invalid("O fim do episódio não pode anteceder o início");
        }
        if (encounter.getStatus() == EncounterStatus.IN_PROGRESS && end != null) {
            throw invalid("Uma admissão in-progress não pode ter data de fim");
        }
        encounter.setStartPeriod(start);
        encounter.setEndPeriod(end);
        return encounter;
    }

    private Instant periodValue(JsonNode resource, String field) {
        Instant legacy = instant(text(resource.path("period"), field));
        Instant actual = instant(text(resource.path("actualPeriod"), field));
        if (legacy != null && actual != null && !legacy.equals(actual)) {
            throw invalid("Encounter.period e actualPeriod são contraditórios");
        }
        return actual == null ? legacy : actual;
    }

    private ParsedLocationDTO location(List<JsonNode> resources, JsonNode encounter) {
        String ward = locationCode(resources, "wa");
        String room = locationCode(resources, "ro");
        String bed = locationCode(resources, "bd");
        ParsedLocationDTO structured = null;
        if (ward != null || room != null || bed != null) {
            structured = new ParsedLocationDTO(required(ward, "Falta Location wa"),
                required(room, "Falta Location ro"), required(bed, "Falta Location bd"));
        }
        ParsedLocationDTO display = null;
        JsonNode encounterLocations = encounter.path("location");
        if (!encounterLocations.isMissingNode() && !encounterLocations.isArray()) {
            throw invalid("Encounter.location deve ser uma lista");
        }
        if (encounterLocations.size() > 1) throw invalid("Localização ambígua: várias Encounter.location");
        for (JsonNode entry : encounterLocations.values()) {
            String value = text(entry.path("location"), "display");
            if (value != null) {
                var matcher = DISPLAY.matcher(value);
                if (!matcher.matches()) throw invalid("Localização deve usar 'Ward …, Room …, Bed …'");
                display = new ParsedLocationDTO(length(matcher.group(1).trim()),
                    length(matcher.group(2).trim()), length(matcher.group(3).trim()));
            }
        }
        if (structured != null && display != null && !structured.equals(display)) {
            throw invalid("Location e Encounter.location.display são contraditórios");
        }
        ParsedLocationDTO result = structured == null ? display : structured;
        if (result == null) throw invalid("Bundle sem localização completa da cama");
        return result;
    }

    private String locationCode(List<JsonNode> resources, String type) {
        List<JsonNode> matches = resources.stream()
            .filter(resource -> hasCoding(resource.path("physicalType"), null, type)).toList();
        if (matches.size() > 1) throw invalid("Localização ambígua para o tipo " + type);
        if (matches.isEmpty()) return null;
        JsonNode resource = matches.getFirst();
        JsonNode identifiers = resource.path("identifier");
        if (!identifiers.isMissingNode() && !identifiers.isArray()) {
            throw invalid("Location.identifier deve ser uma lista");
        }
        String value = text(identifiers.path(0), "value");
        return required(value == null ? text(resource, "name") : value,
            "Location sem código ou nome para o tipo " + type);
    }

    private String identifier(JsonNode resource, String system, String alias, String type, String typeText) {
        JsonNode identifiers = resource.path("identifier");
        if (!identifiers.isMissingNode() && !identifiers.isArray()) {
            throw invalid("identifier deve ser uma lista");
        }
        Set<String> systemValues = new LinkedHashSet<>();
        Set<String> typeValues = new LinkedHashSet<>();
        for (JsonNode id : identifiers.values()) {
            String value = text(id, "value");
            String idSystem = text(id, "system");
            boolean bySystem = system.equals(idSystem) || (alias != null && alias.equals(idSystem));
            boolean byType = hasCoding(id.path("type"), IDENTIFIER_TYPES, type)
                || (typeText != null && typeText.equals(text(id.path("type"), "text")));
            if (bySystem || byType) {
                required(value, "Identificador " + type + " sem valor");
                if (bySystem) systemValues.add(value);
                if (byType) typeValues.add(value);
            }
        }
        if (systemValues.size() > 1 || typeValues.size() > 1
                || (!systemValues.isEmpty() && !typeValues.isEmpty() && !systemValues.equals(typeValues))) {
            throw invalid("Identificadores contraditórios para " + type);
        }
        Set<String> values = systemValues.isEmpty() ? typeValues : systemValues;
        return values.isEmpty() ? null : values.iterator().next();
    }

    private boolean hasCoding(JsonNode concept, String system, String code) {
        for (JsonNode coding : concept.path("coding").values()) {
            if (code.equals(text(coding, "code"))
                    && (system == null || system.equals(text(coding, "system")))) return true;
        }
        return false;
    }

    private void validateSubject(JsonNode patient, JsonNode patientEntry, JsonNode encounter) {
        validateObject(encounter, "subject");
        String reference = text(encounter.path("subject"), "reference");
        if (reference == null) return;
        String id = text(patient, "id");
        String fullUrl = text(patientEntry, "fullUrl");
        if (!reference.equals(fullUrl) && (id == null || !reference.equals("Patient/" + id))) {
            throw invalid("Encounter.subject não referencia o Patient do Bundle");
        }
    }

    private static void validateObject(JsonNode resource, String field) {
        JsonNode value = resource.path(field);
        if (!value.isMissingNode() && !value.isObject()) throw invalid(field + " deve ser um objeto");
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        if (value.isMissingNode() || value.isNull()) return null;
        if (!value.isString()) throw invalid(field + " deve ser texto");
        String result = value.asString().trim();
        return result.isEmpty() ? null : length(result);
    }

    private static String length(String value) {
        if (value != null && value.length() > 255) throw invalid("Texto excede o limite de 255 caracteres");
        return value;
    }

    private static String required(String value, String message) {
        if (value == null || value.isBlank()) throw invalid(message);
        return value;
    }

    private static Instant instant(String value) {
        if (value == null) return null;
        try {
            return OffsetDateTime.parse(value).toInstant().truncatedTo(java.time.temporal.ChronoUnit.MICROS);
        } catch (DateTimeParseException ex) {
            throw invalid("Data/hora deve usar ISO-8601 com fuso horário");
        }
    }

    private static IllegalArgumentException invalid(String detail) {
        return new IllegalArgumentException(detail);
    }
}
