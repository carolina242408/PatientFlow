package com.projinf.patientflow.repository.impl;

import com.projinf.patientflow.domain.model.Encounter;
import com.projinf.patientflow.repository.IEncounterRepository;
import com.projinf.patientflow.repository.jpa.EncounterJpaRepository;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;

@Repository
@Transactional
public class EncounterRepositoryImpl implements IEncounterRepository {

    private final EncounterJpaRepository jpa;

    public EncounterRepositoryImpl(EncounterJpaRepository jpa) {
        this.jpa = jpa;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Encounter> findByVisitNumber(String visitNumber) {
        return jpa.findByVisitNumber(visitNumber);
    }

    @Override
    public Encounter save(Encounter encounter) {
        return jpa.save(encounter);
    }
}
