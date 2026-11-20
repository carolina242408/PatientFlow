package com.projinf.patientflow.ingestion.service;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Transforms FHIR R4 Bundles (from live HL7-to-FHIR conversion,
 * hospital-locations.json,
 * patient bundles, or future HAPI FHIR batch queries) into the flat/normalized
 * JSONB
 * structure consumed by the PostgreSQL stored procedure
 * {@code sp_ingest_fhir_payload(jsonb)}.
 */
@Component
public class FhirToPostgresTransformer {

    private static final Pattern DISPLAY_PATTERN = Pattern.compile(
            "^(Ward\\s+[^,]+),\\s*(Room\\s+[^,]+),\\s*(Bed\\s+[^,]+)$",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern FLOOR_IN_DESC_PATTERN = Pattern.compile(
            "piso\\s+(\\d+)",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern HL7_LOC_DESC_PATTERN = Pattern.compile(
            "^(\\d+)\\s*-\\s*(.+)$");
    private static final DateTimeFormatter HL7_TS_14 = DateTimeFormatter.ofPattern("yyyyMMddHHmmss");
    private static final DateTimeFormatter HL7_TS_12 = DateTimeFormatter.ofPattern("yyyyMMddHHmm");

    private final JsonMapper json;

    public FhirToPostgresTransformer(JsonMapper json) {
        this.json = json;
    }

    public record ResolvedLocation(
            String unitName,
            String floorName,
            String serviceCode,
            String serviceName,
            String wardCode,
            String wardName,
            String roomCode,
            String bedCode,
            String operationalStatus) {
    }

    private static String resolveServiceName(String serviceCode) {
        if (serviceCode == null)
            return "Serviço Geral";
        return switch (serviceCode.trim()) {
            case "30004" -> "MEDICINA INTERNA A";
            case "30006" -> "CIRURGIA GERAL";
            case "30020" -> "MEDICINA INTENSIVA";
            default -> "Serviço " + serviceCode;
        };
    }

    private static String resolveWardName(String wardCode, String fallbackCode) {
        String code = wardCode != null ? wardCode : fallbackCode;
        if (code == null)
            return "Enfermaria Principal";
        String cleanCode = code.replaceFirst("(?i)^Ward\\s+", "").trim();
        return switch (cleanCode) {
            case "30004" -> "MEDICINA INTERNA A";
            case "30006" -> "CIRURGIA GERAL";
            case "30020" -> "MEDICINA INTENSIVA";
            default -> "Enfermaria " + cleanCode;
        };
    }

    private static String ensureDistinctWardName(String wardName, String serviceName, String wardCode) {
        String candidate = wardName == null ? "" : wardName.trim();
        if (candidate.isEmpty() || candidate.equalsIgnoreCase(serviceName)) {
            return "Enfermaria " + (candidate.isEmpty() ? wardCode : candidate);
        }
        return candidate;
    }

    /**
     * Transforms a FHIR Bundle into the JSONB payload expected by
     * {@code sp_ingest_fhir_payload(jsonb)}.
     */
    public ObjectNode transformBundle(JsonNode bundle, String source, Instant eventTimestamp) {
        return transformBundle(bundle, source, eventTimestamp, null);
    }

    /**
     * Transforms a FHIR Bundle into the JSONB payload expected by
     * {@code sp_ingest_fhir_payload(jsonb)},
     * including an optional HL7 trigger code ({@code A01}, {@code A02},
     * {@code A03}).
     */
    public ObjectNode transformBundle(JsonNode bundle, String source, Instant eventTimestamp, String trigger) {
        ObjectNode payload = json.createObjectNode();
        payload.put("source", source != null && !source.isBlank() ? source : "INGESTION_PIPELINE");
        payload.put("autoCreateLocations", true);

        ArrayNode locationsArray = payload.putArray("locations");
        ArrayNode patientsArray = payload.putArray("patients");
        ArrayNode encountersArray = payload.putArray("encounters");

        if (bundle == null || !bundle.isObject()) {
            return payload;
        }

        List<JsonNode> entries = new ArrayList<>();
        if ("Bundle".equals(bundle.path("resourceType").asString("")) && bundle.path("entry").isArray()) {
            for (JsonNode entry : bundle.path("entry").values()) {
                entries.add(entry);
            }
        } else if (!bundle.path("resourceType").asString("").isEmpty()) {
            ObjectNode syntheticEntry = json.createObjectNode();
            syntheticEntry.set("resource", bundle);
            entries.add(syntheticEntry);
        }

        // Pass 1: Collect Organization, Locations, and Patients
        String organizationName = null;
        Map<String, JsonNode> locationResourcesByRef = new LinkedHashMap<>();
        List<JsonNode> wardNodes = new ArrayList<>();
        List<JsonNode> roomNodes = new ArrayList<>();
        List<JsonNode> bedNodes = new ArrayList<>();
        Map<String, String> patientRefToSns = new HashMap<>();
        String firstPatientSns = null;

        for (JsonNode entry : entries) {
            JsonNode res = entry.path("resource");
            if (!res.isObject()) {
                continue;
            }
            String rtype = res.path("resourceType").asString("");
            String id = res.path("id").asString("");
            String fullUrl = entry.path("fullUrl").asString("");

            switch (rtype) {
                case "Organization" -> {
                    String name = res.path("name").asString("").trim();
                    if (!name.isEmpty() && organizationName == null) {
                        organizationName = name;
                    }
                }
                case "Location" -> {
                    if (!id.isEmpty()) {
                        locationResourcesByRef.put("Location/" + id, res);
                    }
                    if (!fullUrl.isEmpty()) {
                        locationResourcesByRef.put(fullUrl, res);
                    }
                    String physType = physicalTypeCode(res);
                    if ("wa".equals(physType)) {
                        wardNodes.add(res);
                    } else if ("ro".equals(physType)) {
                        roomNodes.add(res);
                    } else if ("bd".equals(physType)) {
                        bedNodes.add(res);
                    }
                }
                case "Patient" -> {
                    ObjectNode patNode = transformPatient(res);
                    if (patNode != null) {
                        patientsArray.add(patNode);
                        String sns = patNode.path("snsNumber").asString("");
                        if (firstPatientSns == null) {
                            firstPatientSns = sns;
                        }
                        if (!id.isEmpty()) {
                            patientRefToSns.put("Patient/" + id, sns);
                        }
                        if (!fullUrl.isEmpty()) {
                            patientRefToSns.put(fullUrl, sns);
                        }
                    }
                }
                default -> {
                }
            }
        }

        // Pass 2: Resolve all Location resources in the bundle
        Map<String, ResolvedLocation> resolvedByRef = new HashMap<>();
        ResolvedLocation singleBundleLocation = resolveLocations(
                organizationName,
                locationResourcesByRef,
                wardNodes,
                roomNodes,
                bedNodes,
                resolvedByRef,
                locationsArray);

        // Pass 3: Transform Encounter resources (skipping sub-encounters that have
        // `partOf`)
        for (JsonNode entry : entries) {
            JsonNode res = entry.path("resource");
            if (!res.isObject() || !"Encounter".equals(res.path("resourceType").asString(""))) {
                continue;
            }
            if (res.has("partOf") && !res.path("partOf").isNull()) {
                continue;
            }
            ObjectNode encNode = transformEncounter(
                    res,
                    organizationName,
                    patientRefToSns,
                    firstPatientSns,
                    resolvedByRef,
                    singleBundleLocation,
                    eventTimestamp,
                    trigger);
            if (encNode != null) {
                encountersArray.add(encNode);
            }
        }

        return payload;
    }

    private ResolvedLocation resolveLocations(
            String organizationName,
            Map<String, JsonNode> locationResourcesByRef,
            List<JsonNode> wardNodes,
            List<JsonNode> roomNodes,
            List<JsonNode> bedNodes,
            Map<String, ResolvedLocation> resolvedByRef,
            ArrayNode locationsArray) {
        ResolvedLocation lastResolved = null;

        for (JsonNode bedRes : bedNodes) {
            String bedId = bedRes.path("id").asString("");
            ResolvedLocation resolved = resolveBedLocation(
                    bedRes,
                    organizationName,
                    locationResourcesByRef,
                    wardNodes,
                    roomNodes);
            if (resolved != null) {
                lastResolved = resolved;
                if (!bedId.isEmpty()) {
                    resolvedByRef.put("Location/" + bedId, resolved);
                }
                locationsArray.add(toLocationJson(resolved));
            }
        }

        return lastResolved;
    }

    private ResolvedLocation resolveBedLocation(
            JsonNode bedRes,
            String organizationName,
            Map<String, JsonNode> locationResourcesByRef,
            List<JsonNode> wardNodes,
            List<JsonNode> roomNodes) {
        String rawVal = firstIdentifierValue(bedRes);
        String name = bedRes.path("name").asString("").trim();
        String desc = bedRes.path("description").asString("").trim();
        String opCode = bedRes.path("operationalStatus").path("code").asString("").trim().toUpperCase();
        String opStatus = switch (opCode) {
            case "O" -> "OCCUPIED";
            case "H" -> "CLEANING";
            case "I", "C", "K" -> "BLOCKED";
            default -> "AVAILABLE";
        };

        // Case 1: Combined display string "Ward X, Room Y, Bed Z" (e.g. from
        // Hl7ToFhirConverter)
        String candidateDisplay = rawVal != null ? rawVal : name;
        Matcher displayMatcher = DISPLAY_PATTERN.matcher(candidateDisplay);
        if (displayMatcher.matches()) {
            String wardCodeFull = displayMatcher.group(1).trim();
            String roomCode = displayMatcher.group(2).trim();
            String bedCode = displayMatcher.group(3).trim();
            String rawWard = wardCodeFull.replaceFirst("(?i)^Ward\\s+", "").trim();

            String serviceName = resolveServiceName(rawWard);
            String wardName = ensureDistinctWardName(
                    resolveWardName(rawWard, rawWard),
                    serviceName,
                    rawWard);

            String floorName = "Piso 1";
            if (!desc.isEmpty()) {
                Matcher m = HL7_LOC_DESC_PATTERN.matcher(desc);
                if (m.matches()) {
                    floorName = "Piso " + m.group(1).trim();
                }
            }
            return new ResolvedLocation(
                    organizationName,
                    floorName,
                    rawWard,
                    serviceName,
                    rawWard,
                    wardName,
                    roomCode,
                    bedCode,
                    opStatus);
        }

        // Case 2: Caret-delimited identifier "30004^7001^001" or partOf references
        // (from hospital-locations.json)
        String roomRef = bedRes.path("partOf").path("reference").asString("");
        JsonNode roomRes = !roomRef.isEmpty() ? locationResourcesByRef.get(roomRef)
                : (roomNodes.size() == 1 ? roomNodes.getFirst() : null);
        String wardRef = roomRes != null ? roomRes.path("partOf").path("reference").asString("") : "";
        JsonNode wardRes = !wardRef.isEmpty() ? locationResourcesByRef.get(wardRef)
                : (wardNodes.size() == 1 ? wardNodes.getFirst() : null);

        if (rawVal != null && rawVal.contains("^")) {
            String[] parts = rawVal.split("\\^");
            if (parts.length >= 3) {
                String rawWard = parts[0].trim();
                String rawRoom = parts[1].trim();
                String rawBed = parts[2].trim();

                String serviceName = resolveServiceName(rawWard);
                String wardName = ensureDistinctWardName(
                        wardRes != null ? wardRes.path("name").asString("") : "",
                        serviceName,
                        rawWard);
                String floorName = extractFloorFromWard(wardRes);

                return new ResolvedLocation(
                        organizationName,
                        floorName,
                        rawWard,
                        serviceName,
                        rawWard,
                        wardName,
                        "Room " + rawRoom,
                        "Bed " + rawBed,
                        opStatus);
            }
        }

        // Case 3: Explicit Ward, Room, Bed resources (e.g. standard 3-resource bundle)
        if (wardRes != null && roomRes != null) {
            String wVal = firstIdentifierValueOrName(wardRes);
            String rVal = firstIdentifierValueOrName(roomRes);
            String bVal = firstIdentifierValueOrName(bedRes);
            if (wVal != null && rVal != null && bVal != null) {
                String rawService = wVal.replaceFirst("(?i)^Ward\\s+", "").trim();
                String serviceName = resolveServiceName(rawService);
                String wName = ensureDistinctWardName(
                        wardRes.path("name").asString(""),
                        serviceName,
                        rawService);
                String floorName = extractFloorFromWard(wardRes);

                return new ResolvedLocation(
                        organizationName,
                        floorName,
                        rawService,
                        serviceName,
                        rawService,
                        wName,
                        rVal,
                        bVal,
                        opStatus);
            }
        }

        return null;
    }

    private static String extractFloorFromWard(JsonNode wardRes) {
        if (wardRes == null || !wardRes.isObject()) {
            return "Piso 1";
        }
        String desc = wardRes.path("description").asString("");
        Matcher matcher = FLOOR_IN_DESC_PATTERN.matcher(desc);
        if (matcher.find()) {
            return "Piso " + matcher.group(1);
        }
        return "Piso 1";
    }

    private ObjectNode toLocationJson(ResolvedLocation loc) {
        ObjectNode node = json.createObjectNode();
        if (loc.unitName() != null && !loc.unitName().isBlank()) {
            node.put("unitName", loc.unitName());
        }
        node.put("floorName", loc.floorName());
        node.put("serviceCode", loc.serviceCode());
        node.put("serviceName", loc.serviceName());
        node.put("wardCode", loc.wardCode());
        node.put("wardName", loc.wardName());
        node.put("roomCode", loc.roomCode());
        node.put("bedCode", loc.bedCode());
        node.put("operationalStatus", loc.operationalStatus());
        return node;
    }

    private ObjectNode transformPatient(JsonNode patientRes) {
        String sns = null;
        String hospNumber = null;
        String firstId = null;

        JsonNode identifiers = patientRes.path("identifier");
        if (identifiers.isArray()) {
            for (JsonNode idNode : identifiers.values()) {
                String val = idNode.path("value").asString("").trim();
                if (val.isEmpty()) {
                    continue;
                }
                if (firstId == null) {
                    firstId = val;
                }
                String system = idNode.path("system").asString("").toUpperCase();
                String typeText = idNode.path("type").path("text").asString("").toUpperCase();
                String typeCode = idNode.path("type").path("coding").path(0).path("code").asString("").toUpperCase();

                if ("SNS".equals(typeText) || "SB".equals(typeCode) || system.contains("HAS")
                        || system.contains("SNS")) {
                    sns = val;
                } else if ("NS".equals(typeText) || "MR".equals(typeCode) || system.contains("HOS")
                        || system.contains("PROCESS")) {
                    if (hospNumber == null) {
                        hospNumber = val;
                    }
                }
            }
        }

        if (sns == null || sns.isEmpty()) {
            sns = hospNumber != null ? hospNumber : firstId;
        }
        if (sns == null || sns.isEmpty()) {
            return null;
        }

        String fullName = extractPatientName(patientRes, sns);
        String birthDate = patientRes.path("birthDate").asString("").trim();
        String gender = patientRes.path("gender").asString("unknown").trim().toLowerCase();
        if (!gender.equals("male") && !gender.equals("female") && !gender.equals("other")) {
            gender = "unknown";
        }

        ObjectNode pat = json.createObjectNode();
        pat.put("snsNumber", sns);
        if (hospNumber != null && !hospNumber.isEmpty()) {
            pat.put("hospitalNumber", hospNumber);
        }
        pat.put("fullName", fullName);
        if (!birthDate.isEmpty()) {
            pat.put("birthDate", birthDate);
        }
        pat.put("gender", gender);
        return pat;
    }

    private static String extractPatientName(JsonNode patientRes, String fallbackSns) {
        JsonNode names = patientRes.path("name");
        if (!names.isArray() || names.isEmpty()) {
            return "Doente " + fallbackSns;
        }
        JsonNode chosen = names.path(0);
        for (JsonNode candidate : names.values()) {
            if ("official".equalsIgnoreCase(candidate.path("use").asString(""))) {
                chosen = candidate;
                break;
            }
        }
        String text = chosen.path("text").asString("").trim();
        if (!text.isEmpty()) {
            return text;
        }
        List<String> parts = new ArrayList<>();
        JsonNode given = chosen.path("given");
        if (given.isArray()) {
            for (JsonNode g : given.values()) {
                String gStr = g.asString("").trim();
                if (!gStr.isEmpty()) {
                    parts.add(gStr);
                }
            }
        }
        String family = chosen.path("family").asString("").trim();
        if (!family.isEmpty()) {
            parts.add(family);
        }
        String joined = String.join(" ", parts).trim();
        return joined.isEmpty() ? "Doente " + fallbackSns : joined;
    }

    private ObjectNode transformEncounter(
            JsonNode encRes,
            String organizationName,
            Map<String, String> patientRefToSns,
            String firstPatientSns,
            Map<String, ResolvedLocation> resolvedByRef,
            ResolvedLocation singleBundleLocation,
            Instant eventTimestamp,
            String trigger) {
        String visitNumber = extractVisitNumber(encRes);
        if (visitNumber == null || visitNumber.isEmpty()) {
            return null;
        }

        String subjectRef = encRes.path("subject").path("reference").asString("");
        String sns = !subjectRef.isEmpty() ? patientRefToSns.get(subjectRef) : null;
        if (sns == null || sns.isEmpty()) {
            sns = firstPatientSns;
        }
        if (sns == null || sns.isEmpty()) {
            return null;
        }

        String rawStatus = encRes.path("status").asString("in-progress").trim().toLowerCase();
        String status = ("finished".equals(rawStatus) || "completed".equals(rawStatus)) ? "FINISHED" : "IN_PROGRESS";

        JsonNode periodNode = encRes.has("period") ? encRes.path("period") : encRes.path("actualPeriod");
        String startPeriod = normalizeIsoTimestamp(periodNode.path("start").asString(""));
        String endPeriod = normalizeIsoTimestamp(periodNode.path("end").asString(""));

        // Extract locations / movement history from Encounter.location
        ArrayNode allocationsArray = json.createArrayNode();
        ResolvedLocation activeLocation = null;
        String lastMovementStart = null;

        JsonNode encLocations = encRes.path("location");
        if (encLocations.isArray()) {
            for (JsonNode locEntry : encLocations.values()) {
                ResolvedLocation resolved = null;
                String locRef = locEntry.path("location").path("reference").asString("");
                String locDisplay = locEntry.path("location").path("display").asString("").trim();

                if (!locRef.isEmpty() && resolvedByRef.containsKey(locRef)) {
                    resolved = resolvedByRef.get(locRef);
                } else if (!locDisplay.isEmpty()) {
                    Matcher m = DISPLAY_PATTERN.matcher(locDisplay);
                    if (m.matches()) {
                        String wCodeFull = m.group(1).trim();
                        String rCode = m.group(2).trim();
                        String bCode = m.group(3).trim();
                        String rawW = wCodeFull.replaceFirst("(?i)^Ward\\s+", "").trim();

                        String sName = resolveServiceName(rawW);
                        String wName = resolveWardName(rawW, rawW);

                        resolved = new ResolvedLocation(
                                organizationName,
                                singleBundleLocation != null ? singleBundleLocation.floorName() : "Piso 1",
                                rawW,
                                sName,
                                rawW,
                                wName,
                                rCode,
                                bCode,
                                "AVAILABLE");
                    }
                }

                if (resolved != null) {
                    activeLocation = resolved;
                    String movStart = normalizeIsoTimestamp(locEntry.path("period").path("start").asString(""));
                    String movEnd = normalizeIsoTimestamp(locEntry.path("period").path("end").asString(""));
                    if (movStart != null) {
                        lastMovementStart = movStart;
                    }
                    ObjectNode allocNode = toLocationJson(resolved);
                    if (movStart != null) {
                        allocNode.put("assignedAt", movStart);
                    } else if (startPeriod != null) {
                        allocNode.put("assignedAt", startPeriod);
                    }
                    if (movEnd != null) {
                        allocNode.put("dischargedAt", movEnd);
                    }
                    allocationsArray.add(allocNode);
                }
            }
        }

        if (activeLocation == null) {
            activeLocation = singleBundleLocation;
        }
        if (activeLocation == null) {
            return null;
        }

        ObjectNode encNode = toLocationJson(activeLocation);
        encNode.put("visitNumber", visitNumber);
        encNode.put("snsNumber", sns);
        encNode.put("status", status);
        if (trigger != null && !trigger.isBlank()) {
            encNode.put("trigger", trigger.trim().toUpperCase());
        }
        if (startPeriod != null) {
            encNode.put("startPeriod", startPeriod);
        }
        if (endPeriod != null) {
            encNode.put("endPeriod", endPeriod);
        }

        String effectiveEventTime = eventTimestamp != null
                ? eventTimestamp.toString()
                : (lastMovementStart != null ? lastMovementStart
                        : ("FINISHED".equals(status) && endPeriod != null ? endPeriod : startPeriod));
        if (effectiveEventTime != null) {
            encNode.put("eventTime", effectiveEventTime);
        }

        if (!allocationsArray.isEmpty()) {
            encNode.set("allocations", allocationsArray);
        }
        return encNode;
    }

    static String extractVisitNumber(JsonNode encRes) {
        JsonNode identifiers = encRes.path("identifier");
        if (identifiers.isArray()) {
            for (JsonNode idNode : identifiers.values()) {
                String val = idNode.path("value").asString("").trim();
                if (val.isEmpty()) {
                    continue;
                }
                String system = idNode.path("system").asString("").toUpperCase();
                String typeCode = idNode.path("type").path("coding").path(0).path("code").asString("").toUpperCase();
                if ("VN".equals(typeCode) || system.contains("VISIT") || system.contains("EPISODIO")) {
                    return val;
                }
            }
            String firstVal = identifiers.path(0).path("value").asString("").trim();
            if (!firstVal.isEmpty()) {
                return firstVal;
            }
        }
        String id = encRes.path("id").asString("").trim();
        return id.isEmpty() ? null : id;
    }

    private static String physicalTypeCode(JsonNode locRes) {
        JsonNode codings = locRes.path("physicalType").path("coding");
        if (codings.isArray() && !codings.isEmpty()) {
            return codings.path(0).path("code").asString("").trim();
        }
        return "";
    }

    private static String firstIdentifierValue(JsonNode res) {
        JsonNode ids = res.path("identifier");
        if (ids.isArray() && !ids.isEmpty()) {
            String val = ids.path(0).path("value").asString("").trim();
            if (!val.isEmpty()) {
                return val;
            }
        }
        return null;
    }

    private static String firstIdentifierValueOrName(JsonNode res) {
        String val = firstIdentifierValue(res);
        if (val != null) {
            return val;
        }
        String name = res.path("name").asString("").trim();
        return name.isEmpty() ? null : name;
    }

    public static String normalizeIsoTimestamp(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String trimmed = raw.trim();
        try {
            return OffsetDateTime.parse(trimmed).toInstant().toString();
        } catch (Exception ignored) {
        }
        try {
            return LocalDateTime.parse(trimmed).toInstant(ZoneOffset.UTC).toString();
        } catch (Exception ignored) {
        }
        return null;
    }

    /**
     * Extracts the clinical event timestamp from a raw HL7 v2 message (`EVN-6`
     * occurred,
     * `EVN-2` recorded, or `MSH-7` message datetime) so transfers (`A02`) and
     * discharges (`A03`)
     * carry their exact movement time even when sent as plain HL7 text.
     */
    public static Instant extractEventTimestampFromHl7(String hl7Message) {
        if (hl7Message == null || hl7Message.isBlank()) {
            return null;
        }
        String msh7 = null;
        String evn2 = null;
        String evn6 = null;

        String[] lines = hl7Message.split("\\r\\n|\\r|\\n");
        for (String line : lines) {
            String trimmed = line.trim();
            if (trimmed.startsWith("MSH|")) {
                String[] fields = trimmed.split("\\|", -1);
                if (fields.length > 6 && !fields[6].isBlank()) {
                    msh7 = fields[6].trim();
                }
            } else if (trimmed.startsWith("EVN|")) {
                String[] fields = trimmed.split("\\|", -1);
                if (fields.length > 2 && !fields[2].isBlank()) {
                    evn2 = fields[2].trim();
                }
                if (fields.length > 6 && !fields[6].isBlank()) {
                    evn6 = fields[6].trim();
                }
            }
        }

        String chosen = evn6 != null ? evn6 : (evn2 != null ? evn2 : msh7);
        return parseHl7Timestamp(chosen);
    }

    /**
     * Extracts the ADT trigger code ({@code A01}, {@code A02}, {@code A03}) from a
     * raw HL7 v2 message.
     */
    public static String extractTriggerFromHl7(String hl7Message) {
        if (hl7Message == null || hl7Message.isBlank()) {
            return null;
        }
        for (String line : hl7Message.split("\\r\\n|\\r|\\n")) {
            String trimmed = line.trim();
            if (trimmed.startsWith("MSH|")) {
                String[] fields = trimmed.split("\\|", -1);
                if (fields.length > 8 && !fields[8].isBlank()) {
                    String[] parts = fields[8].trim().split("\\^");
                    if (parts.length > 1 && !parts[1].isBlank()) {
                        return parts[1].trim().toUpperCase();
                    }
                }
            } else if (trimmed.startsWith("EVN|")) {
                String[] fields = trimmed.split("\\|", -1);
                if (fields.length > 1 && !fields[1].isBlank()) {
                    return fields[1].trim().toUpperCase();
                }
            }
        }
        return null;
    }

    private static Instant parseHl7Timestamp(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String clean = raw.split("\\.", 2)[0].trim();
        try {
            if (clean.length() >= 14) {
                return LocalDateTime.parse(clean.substring(0, 14), HL7_TS_14).toInstant(ZoneOffset.UTC);
            }
            if (clean.length() >= 12) {
                return LocalDateTime.parse(clean.substring(0, 12), HL7_TS_12).toInstant(ZoneOffset.UTC);
            }
        } catch (Exception ignored) {
        }
        return null;
    }
}
