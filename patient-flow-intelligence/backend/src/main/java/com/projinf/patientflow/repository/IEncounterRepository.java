package com.projinf.patientflow.repository;

import com.projinf.patientflow.domain.model.Encounter;

import java.util.Optional;

public interface IEncounterRepository {
    Optional<Encounter> findByVisitNumber(String visitNumber);

    Encounter save(Encounter encounter);
}
