package com.projinf.patientflow.strategy;

import com.projinf.patientflow.dto.ParsedBundleDTO;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class EncounterStrategyContext {
    private final Map<String, IEncounterStrategy> strategies;

    public EncounterStrategyContext(Map<String, IEncounterStrategy> strategies) {
        this.strategies = Map.copyOf(strategies);
    }

    public void execute(ParsedBundleDTO bundle) {
        String status = bundle.encounter().getStatus().getFhirCode();
        IEncounterStrategy strategy = strategies.get(status);
        if (strategy == null) throw new IllegalArgumentException("Estado FHIR não suportado: " + status);
        strategy.process(bundle);
    }
}
