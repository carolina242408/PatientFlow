package com.projinf.patientflow.repository.jpa;

import com.projinf.patientflow.domain.model.Condition;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ConditionJpaRepository extends JpaRepository<Condition, String> {
}
