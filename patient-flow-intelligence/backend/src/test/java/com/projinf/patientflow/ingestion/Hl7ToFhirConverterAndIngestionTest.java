package com.projinf.patientflow.ingestion;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.projinf.patientflow.factory.FHIRParserFactory;
import com.projinf.patientflow.ingestion.client.HapiFhirClient;
import com.projinf.patientflow.ingestion.client.HapiFhirClient.HapiStoreResponse;
import com.projinf.patientflow.ingestion.config.IngestionProperties;
import com.projinf.patientflow.ingestion.converter.Hl7ToFhirConverter;
import com.projinf.patientflow.ingestion.service.IngestionPipelineService;
import com.projinf.patientflow.ingestion.service.IngestionPipelineService.IngestionOutcome;
import java.net.URI;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

class Hl7ToFhirConverterAndIngestionTest {

    private static final String SAMPLE_HL7_A01 = """
            MSH|^~\\&|HOS|INST|HL7_DEFAULT|INST|20261001000016||ADT^A01^ADT_A01|61b18b82-7520-46e5-9b04-ce0472d24566|D|2.5\r
            EVN|A01|20261001000011||A|1288^GON\\XC7\\ALVES^FERNANDA^^^^^^HOS|20261001000000|INST\r
            PID|1||1200040^^^HOS^NS~168519648^^^HAS^SNS||SILVA SOARES^PATR\\XCD\\CIA^TERESA^^^^L||19740813000000|F|||RUA DA IGREJA, 195^^RIBEIR\\XC3\\O^BRAGA^4766-335^PRT|||CASADA||15000055^^^HOS\r
            PV1|1|INT|30004^7005^MAC^3007^^Cama^1^4^SALA 1^^HOS|C||10020^^^^^CONSULTA EXTERNA|3216^FERNANDES^NUNO^^^^^^HOS|||30004||||2|||3216^FERNANDES^NUNO^^^^^^HOS||26000018^^^HOS||||||||||||||||||||10004||A|||20260929095100|||||||V\r
            PV2|||K80.20^LITIASE DA VESICULA BILIAR^ICD10|||||||||\r
            DG1|1||K80.20^LITIASE DA VESICULA BILIAR^ICD10^HOS||20260929095100|A|||||||||1||D\r
            """;

    private final JsonMapper json = JsonMapper.builder().build();
    private final Hl7ToFhirConverter converter = new Hl7ToFhirConverter(json);
    private final FHIRParserFactory backendParser = new FHIRParserFactory(
            "https://www.sns.gov.pt/numero-utente",
            "urn:hospital:process-number",
            "urn:hospital:visit-number"
    );

    @Test
    void convertsHl7AdtToFhirBundleWithPatientEncounterParticipantAndCondition() {
        ObjectNode bundle = converter.convert(SAMPLE_HL7_A01);

        assertThat(bundle.path("resourceType").asString()).isEqualTo("Bundle");
        assertThat(bundle.path("entry").size()).isEqualTo(3);

        JsonNode patient = bundle.path("entry").path(0).path("resource");
        JsonNode encounter = bundle.path("entry").path(1).path("resource");
        JsonNode condition = bundle.path("entry").path(2).path("resource");

        assertThat(patient.path("resourceType").asString()).isEqualTo("Patient");
        assertThat(encounter.path("resourceType").asString()).isEqualTo("Encounter");
        assertThat(condition.path("resourceType").asString()).isEqualTo("Condition");

        // Participant translated from PV1-7 & PV1-17
        assertThat(encounter.path("participant").isArray()).isTrue();
        assertThat(encounter.path("participant").size()).isGreaterThanOrEqualTo(1);
        assertThat(encounter.path("participant").path(0).path("individual").path("display").asString())
                .isEqualTo("NUNO FERNANDES");

        // Condition translated from DG1
        assertThat(condition.path("code").path("coding").path(0).path("code").asString())
                .isEqualTo("K80.20");
        assertThat(condition.path("code").path("text").asString())
                .isEqualTo("LITIASE DA VESICULA BILIAR");

        // Also compatible with backend FHIRParserFactory
        var parsedDto = backendParser.parse(bundle);
        assertThat(parsedDto.patient().getSnsNumber()).isEqualTo("168519648");
        assertThat(parsedDto.patient().getHospitalNumber()).isEqualTo("1200040");
        assertThat(parsedDto.encounter().getVisitNumber()).isEqualTo("26000018");
        assertThat(parsedDto.location().wardCode()).isEqualTo("Ward 30004");
        assertThat(parsedDto.location().roomCode()).isEqualTo("Room 7005");
        assertThat(parsedDto.location().bedCode()).isEqualTo("Bed MAC");
    }

    @Test
    void pipelineProcessesRawHl7SseWrapperAndFhirBundleAndStoresInHapi() {
        HapiFhirClient hapiClient = mock(HapiFhirClient.class);
        when(hapiClient.storeBundle(any())).thenReturn(new HapiStoreResponse(true, 200, 3, "OK"));

        IngestionPipelineService pipeline = new IngestionPipelineService(converter, hapiClient, json);

        // 1. Raw HL7
        IngestionOutcome out1 = pipeline.process(SAMPLE_HL7_A01, "RAW_HL7");
        assertThat(out1.convertedFromHl7()).isTrue();
        assertThat(out1.storedInHapi()).isTrue();

        // 2. SSE JSON wrapper from data-generator /api/hl7/live
        ObjectNode sseEvent = json.createObjectNode();
        sseEvent.put("control_id", "61b18b82-7520-46e5-9b04-ce0472d24566");
        sseEvent.put("trigger", "A01");
        sseEvent.put("hl7", SAMPLE_HL7_A01);
        IngestionOutcome out2 = pipeline.process(json.writeValueAsString(sseEvent), "SSE_LIVE");
        assertThat(out2.convertedFromHl7()).isTrue();
        assertThat(out2.storedInHapi()).isTrue();

        // 3. Already a FHIR Bundle (no conversion needed)
        IngestionOutcome out3 = pipeline.process(json.writeValueAsString(out1.fhirBundle()), "FHIR_DIRECT");
        assertThat(out3.convertedFromHl7()).isFalse();
        assertThat(out3.storedInHapi()).isTrue();

        assertThat(pipeline.metrics().totalReceived()).isEqualTo(3);
        assertThat(pipeline.metrics().convertedFromHl7()).isEqualTo(2);
        assertThat(pipeline.metrics().storedInHapi()).isEqualTo(3);
        verify(hapiClient, org.mockito.Mockito.times(3)).storeBundle(any());
    }

    @Test
    void hapiClientTransformsCollectionBundleToR4TransactionBundle() {
        IngestionProperties props = new IngestionProperties(
                true,
                URI.create("http://localhost:8081/fhir"),
                Duration.ofSeconds(5),
                Duration.ofSeconds(15),
                Duration.ofSeconds(5),
                List.of("http://localhost:8001/api/hl7/live")
        );
        HapiFhirClient client = new HapiFhirClient(json, props);
        ObjectNode bundle = converter.convert(SAMPLE_HL7_A01);
        ObjectNode txBundle = client.toR4TransactionBundle(bundle);

        assertThat(txBundle.path("type").asString()).isEqualTo("transaction");
        assertThat(txBundle.path("entry").size()).isEqualTo(3);
        JsonNode r4Encounter = txBundle.path("entry").path(1).path("resource");
        assertThat(r4Encounter.path("class").isObject()).isTrue();
        assertThat(r4Encounter.path("class").path("code").asString()).isEqualTo("IMP");
        assertThat(r4Encounter.path("period").path("start").asString()).isEqualTo("2026-09-29T09:51:00Z");
        assertThat(txBundle.path("entry").path(1).path("request").path("method").asString()).isEqualTo("PUT");
    }
}

