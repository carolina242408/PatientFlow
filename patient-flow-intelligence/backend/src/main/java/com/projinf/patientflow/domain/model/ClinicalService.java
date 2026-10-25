package com.projinf.patientflow.domain.model;

import jakarta.persistence.*;
import java.util.UUID;

@Entity
@Table(name = "clinical_services", uniqueConstraints = @UniqueConstraint(columnNames = {"unit_id", "code"}))
public class ClinicalService {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "unit_id")
    private HealthcareUnit unit;
    @Column(nullable = false)
    private String code;
    @Column(nullable = false)
    private String name;

    public UUID getId() { return id; }
    public HealthcareUnit getUnit() { return unit; }
    public void setUnit(HealthcareUnit unit) { this.unit = unit; }
    public String getCode() { return code; }
    public void setCode(String code) { this.code = code; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
}
