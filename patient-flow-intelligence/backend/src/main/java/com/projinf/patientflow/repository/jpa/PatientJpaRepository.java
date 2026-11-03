package com.projinf.patientflow.repository.jpa;

import com.projinf.patientflow.domain.model.Patient;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface PatientJpaRepository extends JpaRepository<Patient, UUID> {
    Optional<Patient> findBySnsNumber(String snsNumber);
}
