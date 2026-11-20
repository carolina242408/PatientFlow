package com.projinf.patientflow.strategy;

import com.projinf.patientflow.dto.ParsedBundleDTO;

public interface IEncounterStrategy {
    void process(ParsedBundleDTO bundle);
}
