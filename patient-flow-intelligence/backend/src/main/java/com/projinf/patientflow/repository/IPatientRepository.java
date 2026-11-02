package com.projinf.patientflow.repository;

import com.projinf.patientflow.domain.model.Patient;

import java.util.Optional;

public interface IPatientRepository {
    Optional<Patient> findBySns(String sns);

    Patient save(Patient patient);
}
