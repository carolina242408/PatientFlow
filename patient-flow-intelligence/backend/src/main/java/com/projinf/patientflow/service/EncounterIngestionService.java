package com.projinf.patientflow.service;

import com.projinf.patientflow.factory.FHIRParserFactory;
import com.projinf.patientflow.dto.ParsedBundleDTO;
import com.projinf.patientflow.security.AccessPolicy;
import com.projinf.patientflow.strategy.EncounterStrategyContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;

@Service
public class EncounterIngestionService {
    private final FHIRParserFactory parser;
    private final EncounterStrategyContext strategies;
    private final OperationLocks locks;
    private final AccessPolicy access;

    public EncounterIngestionService(FHIRParserFactory parser, EncounterStrategyContext strategies, OperationLocks locks, AccessPolicy access) {
        this.access=access;
        this.parser = parser;
        this.strategies = strategies;
        this.locks = locks;
    }

    @Transactional
    public void ingest(JsonNode bundle) {
        ingest(parser.parse(bundle));
    }

    @Transactional
    public void ingest(ParsedBundleDTO parsed) {
        access.ingestion(parsed);
        locks.visit(parsed.encounter().getVisitNumber());
        locks.patient(parsed.patient().getSnsNumber());
        strategies.execute(parsed);
    }
}
