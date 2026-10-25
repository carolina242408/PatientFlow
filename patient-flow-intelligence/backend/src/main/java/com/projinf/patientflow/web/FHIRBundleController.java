package com.projinf.patientflow.web;

import com.projinf.patientflow.service.EncounterIngestionService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

@RestController
@RequestMapping("/api/fhir")
public class FHIRBundleController {
    private final EncounterIngestionService ingestion;

    public FHIRBundleController(EncounterIngestionService ingestion) {
        this.ingestion = ingestion;
    }

    @PostMapping(value = "/bundles", consumes = {"application/json", "application/fhir+json"})
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void receive(@RequestBody JsonNode bundle) {
        ingestion.ingest(bundle);
    }
}
