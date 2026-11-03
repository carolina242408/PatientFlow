package com.projinf.patientflow.repository.jpa;

import com.projinf.patientflow.domain.model.ULS;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface ULSJpaRepository extends JpaRepository<ULS, UUID> {
}
