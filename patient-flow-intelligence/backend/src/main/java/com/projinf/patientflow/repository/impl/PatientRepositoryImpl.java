package com.projinf.patientflow.repository.impl;

import com.projinf.patientflow.domain.model.Patient;
import com.projinf.patientflow.repository.IPatientRepository;
import com.projinf.patientflow.repository.jpa.PatientJpaRepository;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;

@Repository
@Transactional
public class PatientRepositoryImpl implements IPatientRepository {

    private final PatientJpaRepository jpa;

    public PatientRepositoryImpl(PatientJpaRepository jpa) {
        this.jpa = jpa;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Patient> findBySns(String sns) {
        return jpa.findBySnsNumber(sns);
    }

    @Override
    public Patient save(Patient patient) {
        return jpa.save(patient);
    }
}
